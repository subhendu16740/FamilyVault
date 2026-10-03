// ─── push: reminders on phones and computers (migration 034) ───
//
// Web Push, free: the browser's own push service carries each message to the
// device, encrypted so that service cannot read it (_shared/webpush.ts).
//
//   key   signed in   This project's VAPID public key, for the browser to
//                     subscribe with. The keys are made the first time anyone
//                     asks, and this function leaves its own address in
//                     push_config: that is how run_reminders() finds it.
//   test  signed in   "Reminders are on" to each of the caller's own devices.
//   send  anyone      What is waiting (push_pending) to each owner's devices,
//                     between 8 in the morning and 10 at night, India time.
//                     run_reminders() calls it every hour with the project's
//                     public key, which is in every web bundle, so anyone can
//                     call it. That is safe by construction: it reads nothing
//                     from the request, sends only what is already waiting,
//                     each thing once, to its owner's own devices, never at
//                     night, and a lease keeps runs a minute apart however
//                     often it is called.
//
// Answers 503 { status: 'needs_migration' } where 034 is not applied.
// ────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { generateVapidKeys, sendWebPush, type PushMessage, type PushOutcome, type VapidKeys } from "../_shared/webpush.ts";

// Who push services may contact about this server (RFC 8292's "sub").
const CONTACT = Deno.env.get("PUSH_CONTACT") || "https://github.com/subhendu16740/FamilyVault";
const BATCH = 100;          // notifications per send; the next run takes the rest
const QUIET_FROM = 22;      // India time: nothing is sent from 10 at night…
const QUIET_UNTIL = 8;      // …until 8 in the morning (run_reminders() keeps the same hours)
const AT_ONCE = 8;          // pushes in flight together

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isMissing = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "PGRST202" || error.code === "PGRST205" || /could not find the (function|table)/i.test(error.message ?? ""));

const needsMigration = () =>
  json(503, {
    status: "needs_migration",
    error: "Reminders on devices need a database update that has not been applied here yet (migration 034).",
  });

interface KeyRow { public_key: string; private_key: string; contact: string; has_address?: boolean }
const toKeys = (row: KeyRow): VapidKeys => ({ publicKey: row.public_key, privateKey: row.private_key, subject: row.contact });

/** The stored keys, or null when nobody has turned reminders on yet. */
async function storedKeys(supabase: SupabaseClient): Promise<KeyRow | null | "missing"> {
  const { data, error } = await supabase.rpc("push_keys");
  if (isMissing(error)) return "missing";
  if (error) throw new Error(error.message);
  return ((data ?? []) as KeyRow[])[0] ?? null;
}

/**
 * The keys, made on first use, and this function's address left for
 * run_reminders(). push_setup keeps the first keys stored, so two first calls
 * at once agree on one pair.
 */
async function ensureKeys(supabase: SupabaseClient, req: Request): Promise<VapidKeys | "missing"> {
  const row = await storedKeys(supabase);
  if (row === "missing") return "missing";
  const candidate = row ? { publicKey: row.public_key, privateKey: row.private_key } : await generateVapidKeys();
  const { data, error } = await supabase.rpc("push_setup", {
    p_vapid_public: candidate.publicKey,
    p_vapid_private: candidate.privateKey,
    p_subject: row?.contact ?? CONTACT,
    p_functions_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1`,
    p_anon_key: Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey"),
  });
  if (error) throw new Error(error.message);
  return toKeys(((data ?? []) as KeyRow[])[0]);
}

/** Run `work` over `items`, a few at a time. */
async function inBatches<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(AT_ONCE, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  });
  await Promise.all(lanes);
  return out;
}

const isGone = (o: PushOutcome) => !o.ok && o.gone;
// A push service that is down or busy, as opposed to a device that is gone.
const transient = (o: PushOutcome) => !o.ok && !o.gone && (o.status === 0 || o.status === 429 || o.status >= 500);

interface PendingRow {
  notification_id: string;
  kind: string;
  title: string;
  message: string | null;
  document_ref: string | null;
  family_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The hour in India (UTC+5:30, no daylight saving). */
const indiaHour = () => new Date(Date.now() + 330 * 60_000).getUTCHours();

async function send(supabase: SupabaseClient): Promise<Response> {
  const hour = indiaHour();
  if (hour >= QUIET_FROM || hour < QUIET_UNTIL) return json(200, { skipped: "quiet hours: it waits for the morning" });

  const { data: claimed, error: leaseErr } = await supabase.rpc("push_claim_send");
  if (isMissing(leaseErr)) return needsMigration();
  if (leaseErr) throw new Error(leaseErr.message);
  if (!claimed) return json(200, { skipped: "a send ran within the last minute" });

  const row = await storedKeys(supabase);
  if (row === "missing") return needsMigration();
  if (!row) return json(200, { notifications: 0, sent: 0 });   // nobody has turned reminders on
  const keys = toKeys(row);

  const { data, error } = await supabase.rpc("push_pending", { p_limit: BATCH });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PendingRow[];
  if (!rows.length) return json(200, { notifications: 0, sent: 0 });

  const outcomes = await inBatches(rows, (r) => {
    const message: PushMessage = {
      title: r.title,
      body: r.message ?? undefined,
      url: "/notifications",
      // A newer reminder for the same document replaces the older one on the device.
      tag: `fv-${r.kind}-${r.document_ref ?? r.notification_id}`,
    };
    return sendWebPush({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }, message, keys);
  });

  // A notification is done once tried on every device — unless all it met was
  // a push service that was down: then the next run, within the day, tries again.
  const byNotification = new Map<string, PushOutcome[]>();
  rows.forEach((r, i) => byNotification.set(r.notification_id, [...(byNotification.get(r.notification_id) ?? []), outcomes[i]]));
  const done = [...byNotification].filter(([, list]) => list.some((o) => o.ok) || !list.every(transient)).map(([id]) => id);
  const gone = rows.filter((_, i) => isGone(outcomes[i])).map((r) => r.subscription_id);
  const delivered = rows.filter((_, i) => outcomes[i].ok).map((r) => r.subscription_id);

  const { error: doneErr } = await supabase.rpc("push_done", {
    p_notifications: done,
    p_gone: [...new Set(gone)],
    p_delivered: [...new Set(delivered)],
  });
  if (doneErr) throw new Error(doneErr.message);

  const failed = outcomes.flatMap((o) => (o.ok ? [] : [o]));
  if (failed.length) {
    console.warn("[push] failures:", JSON.stringify(failed.slice(0, 5).map((o) => ({ status: o.status, reason: o.reason }))));
  }
  return json(200, {
    notifications: byNotification.size,
    sent: delivered.length,
    failed: failed.length,
    gone: new Set(gone).size,
    retry: byNotification.size - done.length,
  });
}

async function test(supabase: SupabaseClient, req: Request, userId: string): Promise<Response> {
  const keys = await ensureKeys(supabase, req);
  if (keys === "missing") return needsMigration();
  const { data, error } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (isMissing(error)) return needsMigration();
  if (error) throw new Error(error.message);
  const devices = data ?? [];
  if (!devices.length) return json(200, { devices: 0, sent: 0, failed: 0 });

  const outcomes = await inBatches(devices, (d) => sendWebPush(d, {
    title: "Reminders are on",
    body: "This device will hear from FamilyVault when a document is about to expire.",
    url: "/settings/notifications",
    tag: "fv-test",
  }, keys, { ttlSeconds: 600 }));

  const gone = devices.filter((_, i) => isGone(outcomes[i])).map((d) => d.id);
  const delivered = devices.filter((_, i) => outcomes[i].ok).map((d) => d.id);
  await supabase.rpc("push_done", { p_notifications: [], p_gone: gone, p_delivered: delivered });
  return json(200, {
    devices: devices.length,
    sent: delivered.length,
    failed: devices.length - delivered.length,
    gone: gone.length,
    // Status codes only — never an endpoint — so a failure can be looked up.
    statuses: outcomes.map((o) => o.status),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action } = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "send") return await send(supabase);

    if (action === "key" || action === "test") {
      const auth = await requireUser(req, supabase);
      if (!auth.ok) return auth.response;
      if (action === "test") return await test(supabase, req, auth.userId);
      const keys = await ensureKeys(supabase, req);
      if (keys === "missing") return needsMigration();
      return json(200, { public_key: keys.publicKey });
    }

    return json(400, { error: "action must be key, test or send" });
  } catch (err) {
    console.error("[push]", (err as Error).message);
    return json(500, { error: "Could not reach the reminders service. Please try again." });
  }
});
