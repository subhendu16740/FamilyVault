// ─── razorpay-webhook: Razorpay reporting a payment (migration 044) ───
//
// Razorpay calls this from its own servers, with no Supabase session, so it
// is deployed WITHOUT the gateway's JWT check (--no-verify-jwt, in the deploy
// workflow) — like gmail-callback. What stands in for the check is
// Razorpay's signature: an HMAC-SHA256 of the raw body under
// RAZORPAY_WEBHOOK_SECRET, which only Razorpay and this project know. A body
// without it is refused before it is read.
//
// It does one thing: for payment.captured and order.paid, a payment for an
// order in plan_payments, for that order's amount, is handed to
// apply_plan_payment() — which counts each payment once, so this and the
// app's own verify can both report it. Every other event, and an order that
// is not ours, is answered 200 and ignored, so Razorpay does not retry it.
//
// Set up in the Razorpay dashboard › Settings › Webhooks: this function's
// address, the events payment.captured and order.paid, and a secret, which
// goes in RAZORPAY_WEBHOOK_SECRET.
//
// Answers: 200 { status: applied | ignored | mismatch }   401 bad_signature
//          405 not a POST   503 not_configured | needs_migration   500 (retried)
// ────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ORDER_ID, PAYMENT_ID, webhookSignatureOk } from '../_shared/razorpay.ts';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const HANDLED = new Set(['payment.captured', 'order.paid']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { status: 'method_not_allowed' });

  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';
  if (!secret) return json(503, { status: 'not_configured' });

  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  if (!(await webhookSignatureOk(raw, signature, secret))) return json(401, { status: 'bad_signature' });

  try {
    const event = JSON.parse(raw);
    if (!HANDLED.has(event?.event)) return json(200, { status: 'ignored' });

    const payment = event?.payload?.payment?.entity ?? {};
    const orderId = String(payment.order_id ?? '');
    const paymentId = String(payment.id ?? '');
    if (!ORDER_ID.test(orderId) || !PAYMENT_ID.test(paymentId) || payment.status !== 'captured') {
      return json(200, { status: 'ignored' });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: order, error } = await supabase
      .from('plan_payments')
      .select('amount, currency')
      .eq('order_id', orderId)
      .maybeSingle();
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') return json(503, { status: 'needs_migration' });
      throw error;
    }
    // Not an order this app made: another use of the same Razorpay account.
    if (!order) return json(200, { status: 'ignored' });
    if (Number(payment.amount) !== order.amount || String(payment.currency) !== order.currency) {
      console.error('[razorpay-webhook] payment does not match its order', orderId, paymentId);
      return json(200, { status: 'mismatch' });
    }

    const { data: paidUntil, error: applyErr } = await supabase.rpc('apply_plan_payment', {
      p_order_id: orderId, p_payment_id: paymentId,
    });
    if (applyErr) throw applyErr;
    return json(200, { status: 'applied', paid_until: paidUntil });
  } catch (err) {
    // A 5xx makes Razorpay try again later, which is what a passing fault wants.
    console.error('[razorpay-webhook]', err);
    return json(500, { status: 'error' });
  }
});
