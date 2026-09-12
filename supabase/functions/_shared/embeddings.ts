// ─── Query & passage embeddings (HuggingFace Inference API) ─────
//
// intfloat/multilingual-e5-small: 384 dimensions (the same as the
// English-only model it replaces, so the vector column and the HNSW
// index are unchanged), MIT licensed, and trained on 100 languages
// including Hindi, Bengali, Tamil, Telugu, Marathi and Gujarati.
//
// Because it was trained on translation pairs, a question in one
// language matches a passage in another, so a Hindi question can hit
// an English document directly.
//
// TWO RULES, both easy to get wrong:
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
// ────────────────────────────────────────────────────────────────

export const EMBEDDING_MODEL = 'intfloat/multilingual-e5-small';
export const EMBEDDING_DIMS = 384;

const HF_API_TOKEN = Deno.env.get('HF_API_TOKEN') ?? '';

// HuggingFace has moved this endpoint around; try both shapes.
const ENDPOINTS = [
  `https://api-inference.huggingface.co/models/${EMBEDDING_MODEL}`,
  `https://api-inference.huggingface.co/pipeline/feature-extraction/${EMBEDDING_MODEL}`,
];

/** Embed a question. Returns null when embedding is unavailable, so callers
 *  can fall back to keyword-only retrieval instead of failing the request. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const [vector] = await embedRaw([`query: ${trimmed}`]);
  return vector ?? null;
}

/** Embed document chunks, in order. A failed entry comes back null so the
 *  chunk can still be stored and found by keyword. */
export async function embedPassages(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  const prepared = texts.map(t => `passage: ${t.trim()}`);
  const vectors = await embedRaw(prepared);
  return texts.map((_, i) => vectors[i] ?? null);
}

/** POST to HF and normalise the response into one vector per input. */
async function embedRaw(inputs: string[]): Promise<(number[] | null)[]> {
  const empty = inputs.map(() => null);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (HF_API_TOKEN) headers['Authorization'] = `Bearer ${HF_API_TOKEN}`;

  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ inputs, options: { wait_for_model: true } }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[embed] HF error ${response.status} at ${endpoint}: ${errText.substring(0, 200)}`);
        continue;
      }

      const payload = await response.json();
      if (!Array.isArray(payload) || payload.length !== inputs.length) {
        console.warn(`[embed] Expected ${inputs.length} vectors, got ${payload?.length}`);
        continue;
      }

      // Feature-extraction returns either [dims] or [tokens][dims] per input.
      return payload.map((entry: number[] | number[][]) => {
        const vector = Array.isArray(entry[0])
          ? meanPool(entry as number[][])
          : (entry as number[]);
        if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
          console.warn(`[embed] Expected ${EMBEDDING_DIMS} dims, got ${vector?.length}`);
          return null;
        }
        return normalise(vector);
      });
    } catch (err) {
      console.warn(`[embed] Endpoint failed (${endpoint}):`, err);
    }
  }

  console.warn('[embed] All endpoints failed — falling back to keyword-only retrieval');
  return empty;
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
