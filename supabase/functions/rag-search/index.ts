// ─── FamilyVault RAG Search Edge Function ───────────────────────
// Pipeline: Query → Retrieve matching chunks → LLM generates answer
// Uses: Groq (gpt-oss-120b) for generation, free tier
// ────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { embedText } from '../_shared/embeddings.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
// llama-3.3-70b-versatile was deprecated by Groq on 2026-06-17.
// gpt-oss-120b is Groq's recommended replacement.
const GROQ_MODEL = Deno.env.get('GROQ_MODEL') ?? 'openai/gpt-oss-120b';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { family_id, query } = await req.json();

    if (!family_id || !query) {
      return jsonResponse({ error: 'Missing family_id or query' }, 400);
    }

    console.log(`[rag] Query: "${query}" for family=${family_id}`);

    // 1. Get family schema
    const { data: family, error: famErr } = await supabase
      .from('families')
      .select('storage_namespace')
      .eq('id', family_id)
      .single();

    if (famErr || !family) {
      return jsonResponse({ error: 'Family not found' }, 404);
    }

    const schema = family.storage_namespace;

    // 2. Retrieve relevant chunks using full-text search
    const chunks = await retrieveChunks(schema, query);
    console.log(`[rag] Retrieved ${chunks.length} chunks`);

    if (chunks.length === 0) {
      return jsonResponse({
        answer: "I couldn't find any documents matching your query. Try uploading relevant documents first.",
        sources: [],
      });
    }

    // 3. Build context from chunks
    const context = chunks
      .map((c, i) => `[Document: ${c.file_name}]\n${c.content}`)
      .join('\n\n---\n\n');

    // 4. Generate answer with Groq
    const answer = await generateAnswer(query, context, chunks);
    console.log(`[rag] Generated answer (${answer.length} chars)`);

    // 5. Return answer + source documents
    const sources = [...new Map(chunks.map(c => [c.document_id, {
      id: c.document_id,
      file_name: c.file_name,
      file_type: c.file_type,
      category_name: c.category_name,
    }])).values()];

    return jsonResponse({ answer, sources });

  } catch (err) {
    console.error('[rag] Error:', err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

// ─── Retrieve Chunks ───────────────────────────────────────────

interface ChunkResult {
  document_id: string;
  file_name: string;
  file_type: string;
  category_name: string | null;
  content: string;
  chunk_index: number;
}

async function retrieveChunks(schema: string, query: string): Promise<ChunkResult[]> {
  // Build tsquery from words
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  // Use OR for broader matching
  const tsquery = words.join(' | ');

  if (!tsquery) return [];

  // Embed the query so retrieval can rank semantically as well as lexically.
  // Returns null when HF is unavailable — retrieval then falls back to the
  // keyword-only path inside the RPC rather than failing the request.
  const queryEmbedding = await embedText(query);
  if (!queryEmbedding) {
    console.warn('[rag] No query embedding — keyword-only retrieval for this request');
  }

  // Hybrid retrieval: 0.7 semantic + 0.3 keyword when an embedding is present.
  const { data, error } = await supabase.rpc('rag_retrieve_chunks', {
    p_schema: schema,
    p_tsquery: tsquery,
    p_query_pattern: `%${query}%`,
    p_limit: 10,
    p_query_embedding: queryEmbedding,
  });

  if (error) {
    console.warn('[rag] Chunk retrieval RPC failed, trying direct query:', error.message);
    return await fallbackRetrieve(schema, query, words);
  }

  return (data ?? []) as ChunkResult[];
}

async function fallbackRetrieve(schema: string, query: string, words: string[]): Promise<ChunkResult[]> {
  // Direct SQL fallback — search ocr_text on documents + content on chunks
  const pattern = `%${query}%`;
  const wordPatterns = words.map(w => `%${w}%`);

  // Search documents by ocr_text containing any query word
  const { data: docs, error: docErr } = await supabase
    .from('families')
    .select('storage_namespace')
    .limit(0); // Just to verify connection

  // Use raw SQL via RPC isn't available, so search documents directly
  // This is a simplified fallback
  const { data, error } = await supabase.rpc('search_family_documents', {
    p_family_id: (await supabase.from('families').select('id').eq('storage_namespace', schema).single()).data?.id,
    p_query: words[0] || query, // At least search the first word
    p_limit: 5,
  });

  if (error || !data?.length) return [];

  // Get chunks for matched documents
  const results: ChunkResult[] = [];
  for (const doc of data as any[]) {
    // Fetch chunks for this document from the family schema
    const { data: chunks } = await supabase
      .rpc('get_document_chunks', {
        p_schema: schema,
        p_document_id: doc.id,
        p_limit: 3,
      });

    if (chunks) {
      for (const chunk of chunks as any[]) {
        results.push({
          document_id: doc.id,
          file_name: doc.file_name,
          file_type: doc.file_type,
          category_name: doc.category_name,
          content: chunk.content,
          chunk_index: chunk.chunk_index,
        });
      }
    }
  }

  return results;
}

// ─── Generate Answer (Groq) ────────────────────────────────────

async function generateAnswer(query: string, context: string, chunks: ChunkResult[]): Promise<string> {
  if (!GROQ_API_KEY) {
    return buildFallbackAnswer(query, context, chunks);
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are FamilyVault AI — a helpful assistant that answers questions about a family's documents.
You ONLY answer based on the provided document context. If the answer isn't in the context, say so.
Keep answers concise (1-3 sentences). Include specific details like dates, amounts, and document names.
If you mention a document, reference it by its filename.`,
          },
          {
            role: 'user',
            content: `Context from family documents:\n\n${context}\n\n---\n\nQuestion: ${query}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[rag] Groq API error (${response.status}): ${errText}`);
      return buildFallbackAnswer(query, context, chunks);
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content ?? buildFallbackAnswer(query, context, chunks);

  } catch (err) {
    console.warn('[rag] Groq generation failed:', err);
    return buildFallbackAnswer(query, context, chunks);
  }
}

function buildFallbackAnswer(_query: string, _context: string, chunks: ChunkResult[]): string {
  const docNames = [...new Set(chunks.map(c => c.file_name))];
  return `I found relevant information in ${docNames.length} document(s): ${docNames.join(', ')}. Please review them for details.`;
}

// ─── Helpers ───────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
