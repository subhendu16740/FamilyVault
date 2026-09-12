// ─── Query & passage embeddings (HuggingFace Inference API) ─────
//
// intfloat/multilingual-e5-small: 384 dimensions (the same as the
// English-only model it replaces, so the vector column and the HNSW
// index are unchanged), MIT licensed, and trained on 100 languages
// including Hindi, Bengali, Tamil, Telugu, Marathi and Gujarati.
//
// Because it was trained on translation pairs, a question in one
// language matches a passage in another, so a Hindi question can hit
// an English document directly, with no translation step.
//
// THREE RULES, all easy to get wrong:
//
// 1. E5 requires a prefix. Passages must be embedded as "passage: …"
//    and questions as "query: …". Without them retrieval quality drops
//    sharply — and silently. Use embedPassages / embedQuery rather
//    than calling the API directly.
//
// 2. Query vectors and chunk vectors must come from the SAME model.
//    Mixing produces meaningless distances, so search degrades quietly
//    instead of failing. Changing EMBEDDING_MODEL therefore means
//    re-embedding every stored chunk; migration 013 adds the registry
//    that tracks which families still need it, and rag-search falls
//    back to keyword-only retrieval for a family until it is done.
//
// 3. FAILURES MUST BE LOUD. Every one of this vault's chunks sat with a
//    NULL embedding for the life of the project, because the endpoint we
//    called had been retired (api-inference.huggingface.co now answers
//    410 Gone; HuggingFace moved to router.huggingface.co) and the only
//    sign was a console warning nobody reads. So these functions return
//    the reason alongside the vectors, callers surface it, and the host
//    is a list to try rather than one name to be wrong about.
// ────────────────────────────────────────────────────────────────

export const EMBEDDING_MODEL = 'intfloat/multilingual-e5-small';
export const EMBEDDING_DIMS = 384;

const HF_API_TOKEN = Deno.env.get('HF_API_TOKEN') ?? '';

// Tried in order; the first that answers wins and is remembered for the
// life of the isolate. The router host is current, the rest are history —
// keeping them costs one failed request on a cold start and saves us from
// being wrong about the shape.
const ENDPOINTS = [
  `https://router.huggingface.co/hf-inference/models/${EMBEDDING_MODEL}/pipeline/feature-extraction`,
  `https://router.huggingface.co/hf-inference/models/${EMBEDDING_MODEL}`,
  `https://api-inference.huggingface.co/pipeline/feature-extraction/${EMBEDDING_MODEL}`,
  `https://api-inference.huggingface.co/models/${EMBEDDING_MODEL}`,
];

let workingEndpoint: string | null = null;

export interface EmbedResult {
  /** One entry per input, in order. Null where that input could not be embedded. */
  vectors: (number[] | null)[];
  /** Why nothing came back. Absent on success. */
  error?: string;
}

/** Embed a question. `vector` is null when embedding is unavailable, so
 *  callers can fall back to keyword-only retrieval instead of failing. */
export async function embedQuery(
  text: string,
): Promise<{ vector: number[] | null; error?: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { vector: null, error: 'empty query' };
  const { vectors, error } = await embedRaw([`query: ${trimmed}`]);
  return { vector: vectors[0] ?? null, error };
}

/** Embed document chunks, in order. A failed entry comes back null so the
 *  chunk can still be stored and found by keyword. */
export async function embedPassages(texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) return { vectors: [] };
  const prepared = texts.map(t => `passage: ${t.trim()}`);
  return await embedRaw(prepared);
}

/** POST to HF and normalise the response into one vector per input. */
async function embedRaw(inputs: string[]): Promise<EmbedResult> {
  const empty = inputs.map(() => null);

  if (!HF_API_TOKEN) {
    // The router host requires a token; anonymous access ended with the old
    // endpoint. Say so plainly rather than reporting a generic failure.
    return { vectors: empty, error: 'HF_API_TOKEN is not set' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${HF_API_TOKEN}`,
  };
  const body = JSON.stringify({ inputs, options: { wait_for_model: true } });

  // A known-good endpoint goes first; everything else stays as a fallback in
  // case HuggingFace moves again.
  const candidates = workingEndpoint
    ? [workingEndpoint, ...ENDPOINTS.filter(e => e !== workingEndpoint)]
    : ENDPOINTS;

  let lastError = 'no endpoint answered';

  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers, body });

      if (!response.ok) {
        const errText = (await response.text()).replace(/\s+/g, ' ').slice(0, 160);
        lastError = `HTTP ${response.status}: ${errText}`;
        console.warn(`[embed] ${lastError} at ${endpoint}`);
        continue;
      }

      const payload = await response.json();
      if (!Array.isArray(payload) || payload.length !== inputs.length) {
        lastError = `expected ${inputs.length} vectors, got ${Array.isArray(payload) ? payload.length : typeof payload}`;
        console.warn(`[embed] ${lastError}`);
        continue;
      }

      // Feature-extraction returns either [dims] or [tokens][dims] per input.
      const vectors = payload.map((entry: number[] | number[][]) => {
        const vector = Array.isArray(entry[0])
          ? meanPool(entry as number[][])
          : (entry as number[]);
        if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
          console.warn(`[embed] Expected ${EMBEDDING_DIMS} dims, got ${vector?.length}`);
          return null;
        }
        return normalise(vector);
      });

      if (vectors.every(v => v === null)) {
        lastError = `every vector was the wrong shape (expected ${EMBEDDING_DIMS} dims)`;
        continue;
      }

      if (workingEndpoint !== endpoint) {
        console.log(`[embed] Using ${endpoint}`);
        workingEndpoint = endpoint;
      }
      return { vectors };
    } catch (err) {
      lastError = String(err).slice(0, 160);
      console.warn(`[embed] Endpoint failed (${endpoint}): ${lastError}`);
    }
  }

  console.warn(`[embed] All endpoints failed: ${lastError}`);
  return { vectors: empty, error: lastError };
}

function meanPool(tokenEmbeddings: number[][]): number[] {
  if (tokenEmbeddings.length === 0) return [];
  const dims = tokenEmbeddings[0].length;
  const result = new Array(dims).fill(0);
  for (const emb of tokenEmbeddings) {
    for (let i = 0; i < dims; i++) result[i] += emb[i];
  }
  for (let i = 0; i < dims; i++) result[i] /= tokenEmbeddings.length;
  return result;
}

/** E5 vectors are compared with cosine similarity, which pgvector's `<=>`
 *  already normalises for — but unit vectors keep the stored values
 *  comparable if anything ever switches to inner product or L2. */
function normalise(vector: number[]): number[] {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  if (!norm || !Number.isFinite(norm)) return vector;
  return vector.map(v => v / norm);
}
