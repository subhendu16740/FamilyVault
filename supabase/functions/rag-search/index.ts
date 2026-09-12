// ─── FamilyVault RAG Search Edge Function ───────────────────────
// Pipeline: Query → Retrieve matching chunks → LLM generates answer
// Uses: Groq free tier; models are resolved at runtime (see _shared/groq.ts)
// ────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { embedQuery, EMBEDDING_MODEL } from '../_shared/embeddings.ts';
import { requireFamilyMember } from '../_shared/auth.ts';
import { groqChat, groqText, hasGroqKey } from '../_shared/groq.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// llama-3.3-70b-versatile was deprecated by Groq on 2026-06-17.
// gpt-oss-120b is Groq's recommended replacement.

// Groq's free tier caps gpt-oss-120b at 8,000 tokens per MINUTE. Ten chunks
// of ~500 tokens sent ~5,600 tokens per question, so a second question inside
// a minute was guaranteed to 429 — conversation was impossible by
// construction. Budgeting the context by characters (~4 chars/token) keeps a
// request near 2,000 tokens, which leaves room for three or four questions a
// minute. Retrieval still ranks over all chunks; only what reaches the model
// is trimmed.
const MAX_CONTEXT_CHARS = 6000;
const MAX_CHARS_PER_CHUNK = 1800;

// Conversation. Follow-ups like "and what about this one?" carry no
// retrievable signal on their own, so before retrieving we rewrite them into
// a standalone question using the recent turns. That rewrite goes to a small
// fast model with its own rate-limit pool on Groq, so it costs nothing
// against the answer model's budget.
const MAX_HISTORY_TURNS = 6;        // 3 exchanges
const MAX_HISTORY_CHARS = 600;      // per message, keeps the prompt bounded

// Reranking. Retrieval casts a wide net; a second, cheap model then judges
// each candidate against the actual question and only the best survive.
// This is the missing relevance floor: a tax return that merely mentions
// "2026" scores 1/10 for a placements question and never reaches the answer
// model. The judge runs on the small model, which has its own rate-limit
// pool on Groq, so it costs nothing against the answer model's budget.
const RERANK_CANDIDATES = 15;      // how many retrieval returns for judging
const RERANK_KEEP = 5;             // how many survive into the prompt
const RERANK_MIN_SCORE = 4;        // 0–10; below this a chunk is dropped outright
const RERANK_SNIPPET_CHARS = 350;  // per candidate, keeps the judge call small

/** A document an earlier answer cited — enough to rebuild a ChunkResult. */
interface CitedSource {
  id: string;
  file_name: string;
  file_type: string;
  category_name: string | null;
}

interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Documents the assistant cited in this turn, if any. */
  sources?: CitedSource[];
  /** Legacy shape from older clients; superseded by `sources`. */
  source_ids?: string[];
}

// Follow-ups often refer to a document already on the table ("the latest
// data", "that policy"). Retrieval on the rewritten question usually finds
// it again — but not always, and when it misses the model sees unrelated
// chunks and answers about those instead. So for every follow-up, a few
// chunks from the most recently cited document are pinned into context
// regardless of what retrieval returns. Kept small so it cannot crowd out a
// genuine topic change.
const PIN_MAX_DOCS = 2;
const PIN_CHUNKS_PER_DOC = 2;
const PIN_MAX_CHARS_PER_CHUNK = 900;

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
    const { family_id, query, history: rawHistory, language: rawLanguage, voice: rawVoice } = await req.json();

    // Voice assistant (optional). `language` is a BCP-47 tag for the
    // question and the wanted answer; `voice` means the answer will be read
    // aloud, so it should be written for the ear. Old clients send neither.
    const language = parseLanguage(rawLanguage);
    const voice = rawVoice === true;
    const nonEnglish = !!language && !language.toLowerCase().startsWith('en');

    if (!family_id || !query) {
      return jsonResponse({ error: 'Missing family_id or query' }, 400);
    }

    // The service-role client below bypasses RLS, so this is the only place
    // the caller's right to read this family's documents is ever checked.
    const auth = await requireFamilyMember(req, supabase, family_id);
    if (!auth.ok) return auth.response;

    const history = sanitiseHistory(rawHistory);
    // Did the client send cited documents (new shape) or only IDs (old bundle)?
    // Distinguishes "pinning had nothing to work with" from "pinning failed".
    const clientSentSources = Array.isArray(rawHistory)
      && rawHistory.some((t: unknown) => Array.isArray((t as HistoryTurn)?.sources));
    console.log(`[rag] Query: "${query}" for family=${family_id} (history: ${history.length} turns, sources: ${clientSentSources})`);

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

    // 2. Turn a follow-up into a standalone question, then retrieve on THAT.
    //    "latest available data?" retrieves nothing; "latest ISB placement
    //    data in the 2022 report" retrieves the right document.
    // The documents are indexed in English, so a question asked in Hindi has
    // to be searched in English. That is its own step, not a hint to the
    // condenser: asked to "rewrite as a standalone query", a small model
    // happily rewrites in the language it was given. The answer is still
    // written in the person's language (see generateAnswer).
    const trans = nonEnglish
      ? await translateToEnglish(query)
      : { query, changed: false as boolean, error: undefined as string | undefined, model: undefined as string | undefined };
    if (trans.changed) console.log(`[rag] Translated: "${trans.query}"`);
    else if (nonEnglish) console.warn(`[rag] Not translated${trans.error ? ` (${trans.error})` : ''}`);

    const cond = history.length > 0
      ? await condenseQuery(trans.query, history, { toEnglish: nonEnglish })
      : { query: trans.query, changed: false as boolean, error: undefined as string | undefined, model: undefined as string | undefined };
    const standalone = cond.query;
    if (cond.changed) console.log(`[rag] Condensed: "${standalone}"`);
    else if (history.length > 0) console.log(`[rag] Not condensed${cond.error ? ` (${cond.error})` : ''}`);

    const citedIds = history.flatMap(t => t.source_ids ?? []);
    const indexReady = await isIndexReady(schema);
    if (!indexReady) console.log(`[rag] ${schema} is mid re-embed — keyword-only retrieval`);
    const [pin, retrieved] = await Promise.all([
      history.length > 0 ? pinnedChunks(schema, history) : Promise.resolve({ chunks: [] as ChunkResult[], error: undefined as string | undefined }),
      retrieveChunks(schema, standalone, citedIds, indexReady),
    ]);
    const pinned = pin.chunks;
    const retrievedChunks = retrieved.chunks;
    if (pinned.length) console.log(`[rag] Pinned ${pinned.length} chunk(s) from cited documents`);
    if (pin.error) console.warn(`[rag] Pin error: ${pin.error}`);

    // Pinned chunks are CANDIDATES, not guaranteed context. They join the
    // pool so a document from earlier in the conversation is always
    // considered — and then the judge decides, like everything else. That is
    // what stops last turn's document crowding out this turn's answer when
    // the user changes subject.
    const candidates = dedupeChunks([...pinned, ...retrievedChunks]);
    console.log(`[rag] ${candidates.length} candidate chunks`);

    // 3. Judge every candidate against the question; keep only the relevant.
    const rank = await rerankChunks(standalone, candidates);
    const chunks = rank.kept;
    if (rank.error) console.warn(`[rag] Rerank fell back: ${rank.error}`);
    console.log(`[rag] Kept ${chunks.length}/${candidates.length} after rerank`);

    // Surfaced in the response so a screenshot of the app is a full diagnosis:
    // what was searched, what was pinned, what came back, what survived.
    const uniqNames = (cs: ChunkResult[]) => [...new Set(cs.map(c => c.file_name))];
    const debug = {
      searched_for: standalone,
      history_turns: history.length,
      client_sent_sources: clientSentSources,
      pinned_docs: uniqNames(pinned),
      retrieved_docs: uniqNames(retrievedChunks),
      candidate_count: candidates.length,
      kept_count: chunks.length,
      kept_docs: uniqNames(chunks),
      condensed: cond.changed,
      ...(language ? { language } : {}),
      ...(trans.changed ? { translated: trans.query } : {}),
      ...(indexReady ? {} : { index_rebuilding: true }),
      // Did the question actually get a vector? Without one, retrieval is
      // keyword-only, which finds nothing when the question and the documents
      // are in different scripts. This is the difference between "the index
      // is not ready", "embedding failed" and "there is genuinely no match".
      embedded: retrieved.embedded,
      ...(trans.error ? { translate_error: trans.error } : {}),
      ...(voice ? { voice: true } : {}),
      // Which models actually ran, so a retired one shows up in a screenshot
      // instead of only in the logs. `answer` is filled in below.
      models: {
        ...(cond.model ? { condense: cond.model } : {}),
        ...(rank.model ? { rerank: rank.model } : {}),
      } as { condense?: string; rerank?: string; answer?: string },
      ...(cond.error ? { condense_error: cond.error } : {}),
      ...(pin.error ? { pin_error: pin.error } : {}),
      ...(rank.error ? { rerank_error: rank.error } : {}),
    };

    if (candidates.length === 0) {
      return jsonResponse({
        answer: nothingFoundMessage(language),
        sources: [],
        ...(language ? { answer_language: language } : {}),
        debug,
      });
    }

    // Everything retrieved was judged irrelevant. Say so — and name what was
    // considered — rather than letting the model improvise from junk.
    if (chunks.length === 0) {
      const considered = uniqNames(candidates).slice(0, 3).join(', ');
      return jsonResponse({
        answer: nothingRelevantMessage(language, considered),
        sources: [],
        ...(language ? { answer_language: language } : {}),
        debug,
      });
    }

    // 4. Build context from the survivors, within a token budget.
    const built = buildContext(chunks);
    const context = built.text;

    // 4. Generate answer with Groq
    // The model answers the STANDALONE question. Handing it the raw
    // follow-up ("What about 2026?") next to whatever retrieval found lets it
    // answer a different question from the context instead of the one asked.
    const result = await generateAnswer(standalone, context, chunks, history, { language, voice });
    console.log(
      `[rag] Answer ${result.degraded ? 'DEGRADED' : 'generated'} (${result.answer.length} chars)`,
    );

    // 5. Return answer + source documents
    // Built from the chunks that made it INTO the prompt — not from everything
    // retrieved — so a chip never claims a document the model never read.
    const sources = [...new Map(built.used.map(c => [c.document_id, {
      id: c.document_id,
      file_name: c.file_name,
      file_type: c.file_type,
      category_name: c.category_name,
    }])).values()];

    // `degraded` tells the client the answer did NOT come from the model, so
    // the UI can say so rather than presenting a placeholder as a real answer.
    return jsonResponse({
      answer: result.answer,
      sources,
      degraded: result.degraded,
      ...(result.retryAfterSeconds ? { retry_after_seconds: result.retryAfterSeconds } : {}),
      ...(language ? { answer_language: language } : {}),
      debug: { ...debug, models: { ...debug.models, ...(result.model ? { answer: result.model } : {}) } },
    });

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

async function retrieveChunks(
  schema: string,
  query: string,
  citedIds: string[] = [],
  useVector = true,
): Promise<{ chunks: ChunkResult[]; embedded: boolean }> {
  // Build tsquery from words. Letters and digits in any script, plus the
  // combining marks that Indic scripts need (a Devanagari vowel sign is \p{M}
  // — strip it and the word is gone). Everything else, including tsquery
  // operators like & | ! ( ) : ', is removed.
  const words = query
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  // Use OR for broader matching
  const tsquery = words.join(' | ');

  if (!tsquery) return { chunks: [], embedded: false };

  // Embed the query so retrieval can rank semantically as well as lexically.
  // Returns null when HF is unavailable — retrieval then falls back to the
  // keyword-only path inside the RPC rather than failing the request.
  //
  // `useVector` is false while this family's chunks are still being re-embedded
  // onto the current model. Comparing a new query vector against old chunk
  // vectors would rank by noise, so keyword-only is the correct answer until
  // the rebuild finishes (see _shared/embeddings.ts and migration 013).
  const queryEmbedding = useVector ? await embedQuery(query) : null;
  if (useVector && !queryEmbedding) {
    console.warn('[rag] No query embedding — keyword-only retrieval for this request');
  }

  // Hybrid retrieval: 0.7 semantic + 0.3 keyword when an embedding is present.
  const { data, error } = await supabase.rpc('rag_retrieve_chunks', {
    p_schema: schema,
    p_tsquery: tsquery,
    p_query_pattern: `%${query}%`,
    p_limit: RERANK_CANDIDATES,
    p_query_embedding: queryEmbedding,
  });

  if (error) {
    console.warn('[rag] Chunk retrieval RPC failed, trying direct query:', error.message);
    return { chunks: await fallbackRetrieve(schema, query, words), embedded: false };
  }

  const results = (data ?? []) as ChunkResult[];

  // In a conversation, chunks from documents already on the table should win
  // ties. A stable sort keeps the ranking otherwise intact — this is a nudge,
  // not an override, so a clearly better match elsewhere still surfaces.
  if (citedIds.length > 0) {
    const cited = new Set(citedIds);
    results.sort((a, b) =>
      Number(cited.has(b.document_id)) - Number(cited.has(a.document_id)));
  }

  return { chunks: results, embedded: !!queryEmbedding };
}

// ─── Conversation helpers ──────────────────────────────────────

/** Accept only well-formed recent turns; never trust the shape blindly. */
function sanitiseHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: HistoryTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const role = (t as HistoryTurn).role;
    const content = (t as HistoryTurn).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const rawSources = (t as HistoryTurn).sources;
    const sources: CitedSource[] | undefined = Array.isArray(rawSources)
      ? rawSources
          .filter(x => x && typeof x === 'object' && typeof (x as CitedSource).id === 'string')
          .slice(0, 5)
          .map(x => ({
            id: (x as CitedSource).id,
            file_name: String((x as CitedSource).file_name ?? ''),
            file_type: String((x as CitedSource).file_type ?? ''),
            category_name: (x as CitedSource).category_name ?? null,
          }))
      : undefined;
    const legacyIds = Array.isArray((t as HistoryTurn).source_ids)
      ? (t as HistoryTurn).source_ids!.filter(id => typeof id === 'string').slice(0, 5)
      : undefined;
    const ids = sources?.map(x => x.id) ?? legacyIds;
    turns.push({ role, content: content.slice(0, MAX_HISTORY_CHARS), sources, source_ids: ids });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

/**
 * Pull a few chunks from the document(s) the conversation most recently
 * cited, so a follow-up always has them in view. Uses get_document_chunks,
 * which returns chunks in index order — the opening of a document is the
 * best blind guess for what a follow-up is about.
 */
async function pinnedChunks(
  schema: string,
  history: HistoryTurn[],
): Promise<{ chunks: ChunkResult[]; error?: string }> {
  const lastCited = [...history].reverse().find(t => t.role === 'assistant' && t.sources?.length);
  if (!lastCited?.sources) return { chunks: [], error: 'no cited sources in history' };

  const docs = lastCited.sources.slice(0, PIN_MAX_DOCS);
  const results: ChunkResult[] = [];
  const errors: string[] = [];

  await Promise.all(docs.map(async (doc) => {
    const { data, error } = await supabase.rpc('get_document_chunks', {
      p_schema: schema,
      p_document_id: doc.id,
      p_limit: PIN_CHUNKS_PER_DOC,
    });
    if (error || !data) {
      errors.push(`${doc.file_name}: ${error?.message ?? 'no data'}`);
      return;
    }
    for (const c of data as { content: string; chunk_index: number }[]) {
      results.push({
        document_id: doc.id,
        file_name: doc.file_name,
        file_type: doc.file_type,
        category_name: doc.category_name,
        content: c.content.slice(0, PIN_MAX_CHARS_PER_CHUNK),
        chunk_index: c.chunk_index,
      });
    }
  }));

  return { chunks: results, ...(errors.length ? { error: errors.join('; ') } : {}) };
}

/**
 * Score every candidate against the question in ONE call to the small model,
 * then keep only those above the floor. Any failure returns the candidates
 * unjudged and truncated — worse ranking, never a broken answer.
 */
async function rerankChunks(
  question: string,
  candidates: ChunkResult[],
): Promise<{ kept: ChunkResult[]; error?: string; model?: string }> {
  let usedModel: string | undefined;
  const fallback = (error: string) => ({ kept: candidates.slice(0, RERANK_KEEP), error, model: usedModel });
  if (candidates.length === 0) return { kept: [] };
  if (!hasGroqKey) return fallback('no api key');

  const listing = candidates.map((c, i) => {
    const type = c.category_name ? ` · ${c.category_name}` : '';
    const snippet = c.content.slice(0, RERANK_SNIPPET_CHARS).replace(/\s+/g, ' ');
    return `[${i}] ${c.file_name}${type}\n${snippet}`;
  }).join('\n\n');

  try {
    const { response, model } = await groqChat('rerank', {
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a strict relevance judge for a family document vault.
Score how well each passage answers the question, 0 to 10.
10 = directly contains the answer. 5 = related, partial. 0 = unrelated, even if it shares a word or a year with the question.
Use the document type: an insurance question is not answered by a tax return, a placements question is not answered by a resume.
Reply with JSON only: {"scores":[{"i":0,"s":7}, ...]} — exactly one entry per passage index.`,
        },
        {
          role: 'user',
          content: `Question: ${question}\n\nPassages:\n\n${listing}\n\nReturn the JSON scores.`,
        },
      ],
    });
    usedModel = model;

    if (!response.ok) {
      const errText = await response.text();
      return fallback(`HTTP ${response.status}: ${errText.slice(0, 120)}`);
    }

    const result = await response.json();
    const raw = groqText(result);
    const parsed = JSON.parse(raw) as { scores?: { i: number; s: number }[] };
    if (!Array.isArray(parsed.scores)) return fallback('no scores array');

    const score = new Map<number, number>();
    for (const e of parsed.scores) {
      if (Number.isInteger(e?.i) && typeof e?.s === 'number') score.set(e.i, e.s);
    }

    const kept = candidates
      .map((c, i) => ({ c, s: score.get(i) ?? 0 }))
      .filter(x => x.s >= RERANK_MIN_SCORE)
      .sort((a, b) => b.s - a.s)
      .slice(0, RERANK_KEEP)
      .map(x => x.c);

    console.log(`[rag] Rerank scores: ${candidates.map((c, i) => `${c.file_name.slice(0, 18)}=${score.get(i) ?? '?'}`).join(', ')}`);
    return { kept, model };
  } catch (err) {
    return fallback(String(err).slice(0, 120));
  }
}

/** First occurrence wins, so pinned chunks stay ahead of retrieved duplicates. */
function dedupeChunks(chunks: ChunkResult[]): ChunkResult[] {
  const seen = new Set<string>();
  return chunks.filter(c => {
    const key = `${c.document_id}:${c.chunk_index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Translate a question into English for retrieval. Returns the original on
 * any failure, and reports why, so the outcome is visible in the response.
 */
async function translateToEnglish(
  query: string,
): Promise<{ query: string; changed: boolean; error?: string; model?: string }> {
  if (!hasGroqKey) return { query, changed: false, error: 'no api key' };
  let usedModel: string | undefined;
  try {
    const { response, model } = await groqChat('condense', {
      temperature: 0,
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content: `Translate the user's message into English. It is a question about family documents (passport, PAN card, Aadhaar, insurance, tax returns, bank, property, school).
Keep every name, number, date and abbreviation exactly as given (IDV, PAN, ITR, LIC stay as they are). Do not answer it, do not add anything.
Output ONLY the English translation on one line. No label, no quotes, no explanation.`,
        },
        { role: 'user', content: query },
      ],
    });
    usedModel = model;

    if (!response.ok) {
      const errText = await response.text();
      return { query, changed: false, error: `HTTP ${response.status}: ${errText.slice(0, 100)}`, model };
    }

    const result = await response.json();
    const raw = groqText(result);
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    let text = lines[lines.length - 1] ?? '';
    text = text
      .replace(/^(english|translation)\s*:\s*/i, '')
      .replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '')
      .trim();

    // A translation that still has no Latin letters didn't translate. Report
    // WHAT came back, not just that it was unusable: this runs on a phone
    // where the diagnostic line is the only view of the pipeline, and
    // "unusable output" alone sends everyone to the server logs.
    if (!text || text.length > 400 || !/[a-z]{2,}/i.test(text)) {
      console.warn(`[rag] Translate rejected output: ${JSON.stringify(raw).slice(0, 300)}`);
      const seen = raw ? `"${raw.replace(/\s+/g, ' ').slice(0, 60)}"` : 'empty reply';
      return { query, changed: false, error: `unusable output — ${seen}`, model };
    }
    return { query: text, changed: true, model };
  } catch (err) {
    return { query, changed: false, error: String(err).slice(0, 100), model: usedModel };
  }
}

/**
 * Rewrite a follow-up into a question that stands on its own. Returns the
 * original query on any failure — a bad condensation is worse than none —
 * and reports what happened so the outcome is visible in the response.
 */
async function condenseQuery(
  query: string,
  history: HistoryTurn[],
  opts: { toEnglish?: boolean } = {},
): Promise<{ query: string; changed: boolean; error?: string; model?: string }> {
  if (!hasGroqKey) return { query, changed: false, error: 'no api key' };
  let usedModel: string | undefined;

  const transcript = history.length > 0
    ? history.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n')
    : '(none)';
  const translate = opts.toEnglish
    ? '\nThe documents are in English. Write the query in English, translating the message if it is in another language. Keep names, numbers and dates exactly as given.'
    : '';

  try {
    const { response, model } = await groqChat('condense', {
      temperature: 0,
      max_tokens: 80,
      messages: [
        {
          role: 'system',
          content: `Rewrite the user's latest message as a single standalone search query that makes sense with no conversation history.
Resolve references like "it", "this one", "that policy", "the latest data", "the highest offer" using the conversation.
Keep the SUBJECT of the conversation in the rewrite — if the discussion is about ISB placements and the user asks about "the highest offer", the query is about the highest salary offer in the ISB placements report. Only drop the subject if the user clearly changes topic.
Keep every specific name, document, year and number that matters. Do not answer the question.${translate}
Output ONLY the rewritten query on one line. No label, no quotes, no explanation.`,
        },
        {
          role: 'user',
          content: `Conversation so far:\n${transcript}\n\nLatest message: ${query}`,
        },
      ],
    });
    usedModel = model;

    if (!response.ok) {
      const errText = await response.text();
      return { query, changed: false, error: `HTTP ${response.status}: ${errText.slice(0, 100)}`, model };
    }

    const result = await response.json();
    const raw = groqText(result);

    // Small models add preambles ("Here is the rewritten query:") despite
    // instructions. Take the last non-empty line and strip labels and quotes,
    // rather than rejecting the whole thing and silently using the raw query.
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    let text = lines[lines.length - 1] ?? '';
    text = text
      .replace(/^(rewritten|standalone|search)?\s*query\s*:\s*/i, '')
      .replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '')
      .trim();

    if (!text || text.length > 300) {
      console.warn(`[rag] Condense rejected output: ${JSON.stringify(raw).slice(0, 300)}`);
      const seen = raw ? `"${raw.replace(/\s+/g, ' ').slice(0, 60)}"` : 'empty reply';
      return { query, changed: false, error: `unusable output — ${seen}`, model };
    }

    const changed = text.toLowerCase() !== query.trim().toLowerCase();
    return { query: text, changed, model };
  } catch (err) {
    return { query, changed: false, error: String(err).slice(0, 100), model: usedModel };
  }
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

interface AnswerResult {
  answer: string;
  /** true when the text did not come from the model. */
  degraded: boolean;
  retryAfterSeconds?: number;
  /** Which Groq model produced (or failed to produce) the text. */
  model?: string;
}

async function generateAnswer(
  query: string,
  context: string,
  chunks: ChunkResult[],
  history: HistoryTurn[] = [],
  opts: { language?: string; voice?: boolean } = {},
): Promise<AnswerResult> {
  const langName = opts.language ? languageName(opts.language) : undefined;
  const languageRule = langName && !opts.language!.toLowerCase().startsWith('en')
    ? `\nReply in ${langName}. The documents are in English: translate naturally, but keep proper names, numbers, dates and identifiers exactly as written.`
    : '';
  // Spoken answers: no markdown (a voice reads "asterisk"), no lists, dates
  // in words, and the document described rather than its file name read out.
  const voiceRule = opts.voice
    ? `\nYour answer will be read aloud by a voice assistant to an elderly person. Write two or three short, plain spoken sentences. No markdown, no bullet points, no asterisks, no headings. Write dates in words (for example "14 March 2027"). Describe the document naturally ("this is from Mom's passport") instead of reading out a file name.`
    : '\nIf you mention a document, reference it by its filename.';

  if (!hasGroqKey) {
    console.warn('[rag] GROQ_API_KEY is not set');
    return { answer: buildFallbackAnswer(chunks, 'unavailable'), degraded: true };
  }
  let usedModel: string | undefined;

  try {
    const { response, model } = await groqChat('answer', {
      messages: [
        {
          role: 'system',
          content: `You are FamilyVault AI — a helpful assistant that answers questions about a family's documents.
Today's date is ${todayLabel()}. Use it to interpret "this year", "recently", "latest", "expiring soon" and similar. A document is only about the current year if its own dates say so — never assume a document's year is the current year.
You ONLY answer based on the provided document context.
The context is whatever search returned — it may not actually answer the question. If it doesn't, say so plainly and, if a related document exists, say what it does cover instead. NEVER answer a different question just because the context happens to contain information about it.
This is an ongoing conversation: use earlier turns to understand what the user is referring to.
Keep answers concise (1-3 sentences). Include specific details like dates, amounts, and document names.${languageRule}${voiceRule}`,
        },
        // Prior turns, so "this one" and "that policy" resolve naturally.
        ...history.map(t => ({ role: t.role, content: t.content })),
        {
          role: 'user',
          content: `Context from family documents:\n\n${context}\n\n---\n\nQuestion: ${query}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });
    usedModel = model;

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[rag] Groq API error (${response.status}): ${errText}`);

      // 429 is the common one on the free tier and is worth saying out loud,
      // because "wait twelve seconds" is advice the user can act on.
      if (response.status === 429) {
        const retryAfterSeconds = parseRetryAfter(errText);
        return {
          answer: buildFallbackAnswer(chunks, 'rate_limited', retryAfterSeconds),
          degraded: true,
          retryAfterSeconds,
          model,
        };
      }
      return { answer: buildFallbackAnswer(chunks, 'unavailable'), degraded: true, model };
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content;
    if (!text) {
      console.warn('[rag] Groq returned no content');
      return { answer: buildFallbackAnswer(chunks, 'unavailable'), degraded: true, model };
    }

    return { answer: text, degraded: false, model };

  } catch (err) {
    console.warn('[rag] Groq generation failed:', err);
    return { answer: buildFallbackAnswer(chunks, 'unavailable'), degraded: true, model: usedModel };
  }
}

/**
 * Whether this family's chunk vectors match the model we embed queries with.
 *
 * No row means the family was created after migration 013, so every chunk it
 * has was embedded with the current model — ready. A row exists only for
 * families that predate the multilingual switch, and stays "not ready" until
 * the reembed-index function has walked all of their chunks.
 *
 * On any error we assume NOT ready: keyword-only retrieval is always correct,
 * where a mismatched vector search quietly ranks by noise.
 */
async function isIndexReady(schema: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('family_embedding_state')
    .select('model, completed_at')
    .eq('storage_namespace', schema)
    .maybeSingle();

  if (error) {
    console.warn('[rag] Could not read index state, assuming mid-rebuild:', error.message);
    return false;
  }
  if (!data) return true;
  return !!data.completed_at && data.model === EMBEDDING_MODEL;
}

/** Accept a BCP-47 tag like "hi-IN" or "en"; anything else is ignored. */
function parseLanguage(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  return /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/i.test(t) ? t : undefined;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu',
  mr: 'Marathi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi',
  ur: 'Urdu', or: 'Odia', as: 'Assamese',
};

function languageName(tag: string): string {
  const base = tag.split('-')[0].toLowerCase();
  return LANGUAGE_NAMES[base] ?? tag;
}

// The two "found nothing" answers are not model-written, so they need their
// own translations. Hindi is covered; other languages get English, which the
// client still reads aloud in the chosen voice.
function nothingFoundMessage(language?: string): string {
  const base = (language ?? 'en').split('-')[0].toLowerCase();
  if (base === 'hi') return 'मुझे आपके दस्तावेज़ों में इससे मिलता-जुलता कुछ नहीं मिला। पहले संबंधित दस्तावेज़ अपलोड करें।';
  return "I couldn't find any documents matching your query. Try uploading relevant documents first.";
}

function nothingRelevantMessage(language: string | undefined, considered: string): string {
  const base = (language ?? 'en').split('-')[0].toLowerCase();
  if (base === 'hi') return `मुझे आपके दस्तावेज़ों में इसका जवाब नहीं मिला। सबसे नज़दीकी दस्तावेज़ ${considered} थे, लेकिन उनमें यह जानकारी नहीं है।`;
  return `I couldn't find anything in your documents that answers that. The closest matches were ${considered}, but none of them actually address it.`;
}

/** e.g. "30 August 2026" — unambiguous for the model, no locale surprises. */
function todayLabel(): string {
  const d = new Date();
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Groq reports the wait as "Please try again in 12.06s." */
function parseRetryAfter(errText: string): number | undefined {
  const match = errText.match(/try again in ([\d.]+)s/i);
  if (!match) return undefined;
  return Math.ceil(parseFloat(match[1]));
}

/**
 * Keep the model's context under the free-tier token budget. Chunks arrive
 * ranked, so taking from the front keeps the most relevant material.
 */
function buildContext(chunks: ChunkResult[]): { text: string; used: ChunkResult[] } {
  const parts: string[] = [];
  const used: ChunkResult[] = [];
  let budget = MAX_CONTEXT_CHARS;

  for (const c of chunks) {
    if (budget <= 0) break;
    const body = c.content.slice(0, Math.min(MAX_CHARS_PER_CHUNK, budget));
    // The document TYPE is the single most useful hint for routing a question:
    // "IDV" belongs to the insurance policy, not the tax return beside it.
    const type = c.category_name ? ` | Type: ${c.category_name}` : '';
    parts.push(`[Document: ${c.file_name}${type}]\n${body}`);
    used.push(c);
    budget -= body.length;
  }

  console.log(`[rag] Context: ${parts.length}/${chunks.length} chunks, ${MAX_CONTEXT_CHARS - budget} chars`);
  return { text: parts.join('\n\n---\n\n'), used };
}

function buildFallbackAnswer(
  chunks: ChunkResult[],
  reason: 'rate_limited' | 'unavailable',
  retryAfterSeconds?: number,
): string {
  const docNames = [...new Set(chunks.map(c => c.file_name))];
  const found = docNames.length
    ? ` These documents matched your question: ${docNames.join(', ')}.`
    : '';

  // Say plainly that this is NOT an answer. The previous wording read like a
  // successful reply, which hid a ten-week model outage and a rate limit.
  if (reason === 'rate_limited') {
    const wait = retryAfterSeconds ? `about ${retryAfterSeconds} seconds` : 'a moment';
    return `I couldn't answer that one — the AI service is rate limited right now. Try again in ${wait}.${found}`;
  }
  return `I couldn't answer that one — the AI service is unavailable right now.${found}`;
}


// ─── Helpers ───────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
