// ─── Talking to DEV the way the app does ────────────────────────
//
// Three actors: QA account A (owns QA Vault A, where the questions are
// asked), QA account B (a stranger to A, for the access checks) and a
// logged-out visitor holding only the public anon key.
//
// Edge Functions are called with fetch rather than supabase-js, because the
// checks care about the exact HTTP status (401 vs 403 vs 200) and
// supabase-js folds every non-2xx into one opaque error.
// ────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function anonActor(cfg) {
  return { label: 'logged-out visitor', client: createClient(cfg.url, cfg.anonKey, OPTIONS), token: cfg.anonKey, user: null };
}

export async function signIn(cfg, label, { email, password }) {
  const client = createClient(cfg.url, cfg.anonKey, OPTIONS);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.session) throw new Error(`${label} could not sign in: ${error?.message ?? 'no session returned'}`);
  return { label, client, token: data.session.access_token, user: data.user };
}

/** POST an Edge Function; never throws, so a check can judge any outcome. */
export async function invokeFunction(cfg, actor, name, body, { timeoutMs = 150_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${cfg.url}/functions/v1/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${actor.token}`, apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    return { status: res.status, data, ms: Date.now() - started };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? `timed out after ${timeoutMs / 1000}s` : String(err?.message ?? err);
    return { status: 0, data: { error: reason }, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
