// ─── payments: paying for Family Plus with Razorpay (migration 044) ───
//
// JSON POSTs, one action each:
//
//   status   anyone: { available, key_id, currencies, currency }. Whether
//            this project takes payments (the app says "Coming soon" until
//            it does), and which currency this person pays in: the server's
//            choice from the connection's country and the device's time
//            zone ({ time_zone }), payerCurrency().
//   order    a member, for their own family: { family_id, period, currency,
//            time_zone }. Refuses a currency other than the server's choice
//            (409 wrong_currency, with the right one). Makes a Razorpay order
//            for PLUS_PRICE's amount (never the client's), keeps it in
//            plan_payments, and answers what the checkout needs.
//   verify   a member, after the checkout: { order_id, payment_id, signature }.
//            Checks Razorpay's signature with the key secret, asks Razorpay
//            that the payment is for this order's amount and captured
//            (capturing it if only authorised), then apply_plan_payment()
//            adds the month or year. Asking twice changes nothing.
//
// razorpay-webhook reports the same payments, so a family whose browser
// closed before verify still gets its Plus.
//
// Secrets, per project: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test keys on
// DEV, live keys on PROD), and RAZORPAY_CURRENCIES, optional ("INR,USD" once
// international payments are switched on in Razorpay).
//
// Answers: 200   400 bad_request | bad_signature | currency   401/403 not
// signed in / not a member   402 not_paid   404 no_order   409 wrong_currency
// 502 razorpay (Razorpay said no)   503 not_configured | needs_migration
// ────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireFamilyMember } from '../_shared/auth.ts';
import {
  ORDER_ID, PAYMENT_ID, acceptedCurrencies, connectionCountry, payerCurrency, payerCurrencyMessage,
  paymentSignatureOk, plusOrderAmount, plusOrderDescription, type RazorpayCurrency,
} from '../_shared/razorpay.ts';

const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
const CURRENCIES = acceptedCurrencies(Deno.env.get('RAZORPAY_CURRENCIES'));
const API = 'https://api.razorpay.com/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const NOT_CONFIGURED = { status: 'not_configured', error: 'Paying for Family Plus is not switched on yet.' };
const NEEDS_MIGRATION = { status: 'needs_migration', error: 'Paying for Family Plus is not switched on yet.' };

const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (['42P01', 'PGRST205', 'PGRST202'].includes(String(e.code)) || /does not exist|could not find/i.test(e.message ?? ''));

/** One call to Razorpay's API, with the key pair. */
async function razorpay(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Basic ${btoa(`${KEY_ID}:${KEY_SECRET}`)}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: data as Record<string, any> };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    // Who pays in rupees and who in dollars: where the connection comes from
    // (Cloudflare's header) and the device's time zone. Nothing is kept.
    const country = connectionCountry(req.headers.get('cf-ipcountry'));
    const payIn = payerCurrency(country, body?.time_zone);

    if (action === 'status') {
      const available = !!(KEY_ID && KEY_SECRET);
      return json(200, {
        available, key_id: available ? KEY_ID : null, currencies: available ? CURRENCIES : [],
        // The caller's own country, so QA can check the rule from wherever it runs.
        currency: payIn, currency_from: country ? 'connection' : payIn ? 'time_zone' : null, country,
      });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'order') {
      const { family_id: familyId, period, currency } = body;
      if (typeof familyId !== 'string' || !UUID.test(familyId) || (period !== 'monthly' && period !== 'yearly')) {
        return json(400, { status: 'bad_request', error: 'Which family, and a month or a year?' });
      }
      const auth = await requireFamilyMember(req, supabase, familyId);
      if (!auth.ok) return auth.response;
      if (!KEY_ID || !KEY_SECRET) return json(503, NOT_CONFIGURED);
      const cur = (typeof currency === 'string' ? currency.toUpperCase() : payIn ?? 'INR') as RazorpayCurrency;
      if (payIn && cur !== payIn) {
        return json(409, { status: 'wrong_currency', currency: payIn, error: payerCurrencyMessage(payIn) });
      }
      if (!CURRENCIES.includes(cur)) {
        return json(400, { status: 'currency', error: "You can't pay in this currency yet." });
      }

      const amount = plusOrderAmount(period, cur);

      const userId = auth.member.userId;
      const newOrder = async (): Promise<string | null> => {
        const created = await razorpay('/orders', {
          method: 'POST',
          body: {
            amount,
            currency: cur,
            receipt: `fv_${familyId.slice(0, 8)}_${Date.now().toString(36)}`,
            notes: { family_id: familyId, period, user_id: userId },
          },
        });
        if (!created.ok || !ORDER_ID.test(String(created.data.id ?? ''))) {
          console.error('[payments] order refused:', created.status, JSON.stringify(created.data).slice(0, 300));
          return null;
        }

        const { error: saveErr } = await supabase.from('plan_payments').insert({
          order_id: created.data.id, family_id: familyId, user_id: userId, period, currency: cur, amount,
        });
        if (saveErr) throw saveErr;
        return String(created.data.id);
      };

      // Tapping Pay again within the hour reuses the order not yet paid, for
      // the same person, family and price, rather than making another order
      // at Razorpay and another row here each time (050). Razorpay takes a
      // new attempt on an order until one is paid.
      const { data: open, error: openErr } = await supabase
        .from('plan_payments')
        .select('order_id')
        .eq('family_id', familyId).eq('user_id', userId)
        .eq('period', period).eq('currency', cur).eq('amount', amount).eq('status', 'created')
        .gt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openErr && missingTable(openErr)) return json(503, NEEDS_MIGRATION);
      const orderId = open?.order_id ? String(open.order_id) : await newOrder();
      if (!orderId) {
        return json(502, { status: 'razorpay', error: 'Razorpay could not start the payment. Please try again.' });
      }

      // For the checkout's form and Razorpay's receipt email.
      const { data: who } = await supabase.auth.admin.getUserById(userId);
      return json(200, {
        order_id: orderId,
        amount,
        currency: cur,
        key_id: KEY_ID,
        description: plusOrderDescription(period),
        prefill: {
          email: who?.user?.email ?? undefined,
          name: who?.user?.user_metadata?.display_name ?? who?.user?.user_metadata?.full_name ?? undefined,
        },
      });
    }

    if (action === 'verify') {
      const { order_id: orderId, payment_id: paymentId, signature } = body;
      if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)
        || typeof paymentId !== 'string' || !PAYMENT_ID.test(paymentId) || typeof signature !== 'string') {
        return json(400, { status: 'bad_request', error: 'That payment could not be read.' });
      }

      const { data: order, error: readErr } = await supabase
        .from('plan_payments')
        .select('family_id, amount, currency, status, paid_until')
        .eq('order_id', orderId)
        .maybeSingle();
      if (readErr) {
        if (missingTable(readErr)) return json(503, NEEDS_MIGRATION);
        throw readErr;
      }
      if (!order) return json(404, { status: 'no_order', error: "We couldn't find that payment." });
      const auth = await requireFamilyMember(req, supabase, order.family_id);
      if (!auth.ok) return auth.response;

      // The webhook may have got here first.
      if (order.status === 'paid') return json(200, { status: 'paid', paid_until: order.paid_until });
      if (!KEY_ID || !KEY_SECRET) return json(503, NOT_CONFIGURED);
      if (!(await paymentSignatureOk(orderId, paymentId, signature, KEY_SECRET))) {
        return json(400, { status: 'bad_signature', error: "We couldn't confirm that payment." });
      }

      let payment = await razorpay(`/payments/${paymentId}`);
      if (!payment.ok) {
        console.error('[payments] payment lookup failed:', payment.status, JSON.stringify(payment.data).slice(0, 300));
        return json(502, { status: 'razorpay', error: 'Razorpay could not confirm the payment yet. Please try again in a minute.' });
      }
      const p = payment.data;
      if (p.order_id !== orderId || Number(p.amount) !== order.amount || String(p.currency) !== order.currency) {
        console.error('[payments] payment does not match its order', orderId, paymentId);
        return json(400, { status: 'bad_signature', error: "We couldn't confirm that payment." });
      }
      if (p.status === 'authorized') {
        payment = await razorpay(`/payments/${paymentId}/capture`, {
          method: 'POST', body: { amount: order.amount, currency: order.currency },
        });
      }
      if (!payment.ok || payment.data.status !== 'captured') {
        return json(402, { status: 'not_paid', error: "The payment didn't go through. You weren't charged." });
      }

      const { data: paidUntil, error: applyErr } = await supabase.rpc('apply_plan_payment', {
        p_order_id: orderId, p_payment_id: paymentId,
      });
      if (applyErr) {
        if (missingTable(applyErr)) return json(503, NEEDS_MIGRATION);
        throw applyErr;
      }
      return json(200, { status: 'paid', paid_until: paidUntil });
    }

    return json(400, { status: 'bad_request', error: 'Unknown action.' });
  } catch (err) {
    console.error('[payments]', err);
    return json(500, { status: 'error', error: 'Something went wrong. Please try again.' });
  }
});
