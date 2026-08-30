// ─── Query & text embeddings (HuggingFace Inference API) ────────
//
// MUST stay on the same model that ingest-document used to embed the
// stored chunks. Comparing a query vector from one model against
// chunk vectors from another produces meaningless distances — the
// search silently degrades rather than failing, which is worse.
//
// Changing EMBEDDING_MODEL therefore requires re-embedding every
// existing chunk and rebuilding the HNSW index.
// ────────────────────────────────────────────────────────────────

export const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
export const EMBEDDING_DIMS = 384;

const HF_API_TOKEN = Deno.env.get('HF_API_TOKEN') ?? '';

// HuggingFace has moved this endpoint around; try both shapes.
const ENDPOINTS = [
  `https://api-inference.huggingface.co/models/${EMBEDDING_MODEL}`,
  `https://api-inference.huggingface.co/pipeline/feature-extraction/${EMBEDDING_MODEL}`,
];

/**
 * Embed a single string. Returns null when embedding is unavailable,
 * so callers can fall back to keyword-only retrieval instead of failing.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (HF_API_TOKEN) headers['Authorization'] = `Bearer ${HF_API_TOKEN}`;

  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inputs: [trimmed],
          options: { wait_for_model: true },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[embed] HF error ${response.status} at ${endpoint}: ${errText.substring(0, 200)}`);
        continue;
      }

      const payload = await response.json();
      if (!Array.isArray(payload) || payload.length === 0) {
        console.warn('[embed] Unexpected response shape');
        continue;
      }

      // Feature-extraction returns either [dims] or [tokens][dims].
      const first = payload[0];
      const vector = Array.isArray(first?.[0])
        ? meanPool(first as number[][])
        : (first as number[]);

      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
        console.warn(`[embed] Expected ${EMBEDDING_DIMS} dims, got ${vector?.length}`);
        continue;
      }

      return vector;
    } catch (err) {
      console.warn(`[embed] Endpoint failed (${endpoint}):`, err);
    }
  }

  console.warn('[embed] All endpoints failed — falling back to keyword-only retrieval');
  return null;
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
