// ─── Groq chat with resilient model selection ───────────────────
//
// Groq retires free-tier models with a few weeks' notice, and a retired
// model returns a 404 — which, if the name is hardcoded, silently turns a
// helper step (condense, rerank) into a no-op, or the answer step into a
// "service unavailable" placeholder. Twice now this has happened in
// production (llama-3.3-70b-versatile in June, llama-3.1-8b-instant in
// August).
//
// This module owns the model choice so it never has to be right forever:
//
//   1. Each role has a preference list. A secret of the role's env name
//      (GROQ_MODEL, GROQ_CONDENSE_MODEL, GROQ_RERANK_MODEL) always goes first,
//      so an operator can override without a deploy.
//   2. On the first call in an isolate we ask /models what actually exists
//      and drop anything that doesn't. The list is cached for an hour.
//   3. If a call still comes back "model not found / decommissioned", that
//      model is marked dead for the life of the isolate and the request is
//      retried ONCE on the next candidate.
//
// If /models is unreachable we fall back to the preference order alone; the
// 404 retry still covers a retired model. Nothing here ever throws — the
// caller sees the final Response and decides what a failure means for it.
// ────────────────────────────────────────────────────────────────

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const MODEL_LIST_TTL_MS = 60 * 60 * 1000;

export type GroqRole = 'answer' | 'condense' | 'rerank';

export const hasGroqKey = GROQ_API_KEY.length > 0;

// Free-tier models on Groq, most capable first. Keep this list SHORT and
// only ever append names confirmed at https://console.groq.com/docs/models
// — a wrong name here is harmless (filtered out or 404-retried) but useless.
const ANSWER_FALLBACKS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
// Helper roles need speed and a rate-limit pool separate from the answer
// model's, so the 20b model leads; the 120b is a last resort that shares the
// answer budget rather than doing nothing.
const HELPER_FALLBACKS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

const ROLE_ENV: Record<GroqRole, string> = {
  answer: 'GROQ_MODEL',
  condense: 'GROQ_CONDENSE_MODEL',
  rerank: 'GROQ_RERANK_MODEL',
};

function preferences(role: GroqRole): string[] {
  const pinned = Deno.env.get(ROLE_ENV[role])?.trim();
  const list = role === 'answer' ? ANSWER_FALLBACKS : HELPER_FALLBACKS;
  return [...new Set([...(pinned ? [pinned] : []), ...list])];
}

// Per-isolate state. Edge Function isolates live for minutes to hours, so a
// dead model is remembered across requests but forgotten on the next cold
// start — which is also when a fresh /models list is fetched.
let available: Set<string> | null = null;
let availableAt = 0;
let listing: Promise<void> | null = null;
const dead = new Set<string>();

async function refreshAvailable(): Promise<void> {
  if (!hasGroqKey) return;
  if (available && Date.now() - availableAt < MODEL_LIST_TTL_MS) return;
  if (listing) return listing;
  listing = (async () => {
    try {
      const res = await fetch(`${GROQ_BASE}/models`, {
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      });
      if (!res.ok) {
        console.warn(`[groq] /models returned ${res.status}; using preference order only`);
        return;
      }
      const body = await res.json() as { data?: { id?: string; active?: boolean }[] };
      const ids = (body.data ?? [])
        .filter(m => m.id && m.active !== false)
        .map(m => m.id as string);
      if (ids.length === 0) return;
      available = new Set(ids);
      availableAt = Date.now();
    } catch (err) {
      console.warn('[groq] /models unreachable; using preference order only:', err);
    } finally {
      listing = null;
    }
  })();
  return listing;
}

/** The model this role will use right now, after availability and deaths. */
export async function resolveModel(role: GroqRole): Promise<string> {
  await refreshAvailable();
  const prefs = preferences(role);
  for (const id of prefs) {
    if (dead.has(id)) continue;
    if (available && !available.has(id)) continue;
    return id;
  }
  // Nothing passed the filters — an operator-pinned model that /models doesn't
  // list, or every fallback dead. Try the first non-dead name and let the
  // request fail honestly rather than inventing a model.
  return prefs.find(id => !dead.has(id)) ?? prefs[0];
}

/** Groq's ways of saying "that model name is not going to work, ever". */
function modelIsGone(status: number, body: string): boolean {
  if (status === 404) return true;
  return /model_not_found|model_decommissioned|decommissioned|does not exist/i.test(body);
}

export interface GroqChatResult {
  response: Response;
  /** The model the returned response actually came from. */
  model: string;
}

/**
 * POST /chat/completions with the role's current model. `body` is the usual
 * request minus `model`. On a dead-model error the call is retried once on
 * the next candidate; the returned Response is unconsumed either way.
 */
export async function groqChat(
  role: GroqRole,
  body: Record<string, unknown>,
): Promise<GroqChatResult> {
  let model = await resolveModel(role);

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({ ...body, model }),
    });

    if (response.ok || attempt > 0) return { response, model };

    // Peek without consuming, so the caller can still read the error text.
    const text = await response.clone().text();
    if (!modelIsGone(response.status, text)) return { response, model };

    dead.add(model);
    const next = await resolveModel(role);
    if (next === model) return { response, model };
    console.warn(`[groq] ${role}: ${model} is gone (${response.status}); retrying on ${next}`);
    model = next;
  }
}
