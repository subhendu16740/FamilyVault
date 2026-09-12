// ─── Splitting a document into searchable passages ──────────────
//
// The size of a chunk is not a style choice: the embedding model reads a
// fixed window and silently ignores everything past it. multilingual-e5-small
// takes 512 tokens. A chunk longer than that is embedded from its opening
// only — the rest of the text is in the database, findable by keyword, and
// invisible to every question asked in other words.
//
// That is what was happening to this vault. Chunks averaged ~1,750
// characters and ran to 3,642, so the tail of most passages was outside the
// model's window, and one resume was a single chunk with everything after
// its first page unreachable.
//
// TOKENS ARE NOT CHARACTERS, and the ratio depends on the script. The old
// estimate of "1 token ≈ 4 characters" holds for English and is roughly
// double the truth for Devanagari, Bengali or Tamil, where the tokenizer
// emits a token every 1-2 characters. Sizing Hindi by the English rule
// produces chunks that overflow the window by a wide margin — so the
// estimate below counts non-ASCII characters at twice the weight, and
// Indian-language documents chunk smaller of their own accord.
// ────────────────────────────────────────────────────────────────

export interface Chunk {
  content: string;
  chunk_index: number;
  token_count: number;
}

/** The model's real limit is 512; this leaves room for the "passage: " prefix
 *  and for the estimate below being an estimate. */
export const MAX_CHUNK_TOKENS = 400;
/** What we aim for, so most chunks sit comfortably under the ceiling. */
export const TARGET_CHUNK_TOKENS = 320;
/** Carried from the end of one chunk into the next, so a fact split across a
 *  boundary is still whole in one of them. */
export const CHUNK_OVERLAP_TOKENS = 50;

/**
 * Tokens a piece of text is worth, near enough to size a chunk by.
 *
 * Latin text runs about 4 characters per token. Indic scripts run closer to
 * 2 — the tokenizer was trained mostly on Latin text, so it splits Devanagari
 * and friends far more finely. Counting non-ASCII at double weight keeps a
 * Hindi chunk inside the same window as an English one.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let wide = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else wide++;
  }
  return Math.ceil(ascii / 4 + wide / 2);
}

/** Characters that end a sentence, including the Devanagari danda. */
const SENTENCE_END = /(?<=[.!?।॥])\s+/;

/**
 * Split `text` into passages no larger than the embedding window.
 *
 * Works down a cascade — paragraphs, then lines, then sentences, then a hard
 * cut — so it keeps natural boundaries where they exist and still guarantees
 * a ceiling where they do not. OCR output frequently has no blank lines and
 * sometimes no punctuation at all, which is exactly the case the old splitter
 * gave up on and emitted one enormous chunk for.
 */
export function chunkText(
  text: string,
  targetTokens = TARGET_CHUNK_TOKENS,
  overlapTokens = CHUNK_OVERLAP_TOKENS,
  maxTokens = MAX_CHUNK_TOKENS,
): Chunk[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  // Atoms are the largest pieces that already fit; packing only ever joins
  // them, so no chunk can exceed the ceiling by construction.
  const atoms = splitToFit(cleaned, maxTokens);

  const chunks: Chunk[] = [];
  let current = '';

  const flush = () => {
    const content = current.trim();
    if (!content) return;
    chunks.push({
      content,
      chunk_index: chunks.length,
      token_count: estimateTokens(content),
    });
  };

  for (const atom of atoms) {
    const joined = current ? `${current}\n${atom}` : atom;
    if (current && estimateTokens(joined) > targetTokens) {
      flush();
      current = `${tailFor(current, overlapTokens)}\n${atom}`.trim();
      // The overlap must not push the new chunk over the ceiling on its own.
      if (estimateTokens(current) > maxTokens) current = atom;
    } else {
      current = joined;
    }
  }
  flush();

  return chunks;
}

/** Break a string down until every piece fits, trying gentler cuts first. */
function splitToFit(text: string, maxTokens: number): string[] {
  const out: string[] = [];

  const descend = (piece: string, level: number) => {
    const trimmed = piece.trim();
    if (!trimmed) return;
    if (estimateTokens(trimmed) <= maxTokens) {
      out.push(trimmed);
      return;
    }

    let parts: string[];
    switch (level) {
      case 0: parts = trimmed.split(/\n{2,}/); break;      // paragraphs
      case 1: parts = trimmed.split(/\n/); break;          // lines
      case 2: parts = trimmed.split(SENTENCE_END); break;  // sentences
      case 3: parts = trimmed.split(/(?<=[,;:])\s+/); break; // clauses
      default: return hardSlice(trimmed, maxTokens, out);   // no boundary left
    }

    // A split that changed nothing means this level has no boundaries here;
    // drop to the next one rather than recursing forever.
    if (parts.length <= 1) {
      descend(trimmed, level + 1);
      return;
    }
    for (const part of parts) descend(part, level + 1);
  };

  descend(text, 0);
  return out;
}

/** Last resort: cut on whitespace near the budget, or mid-word if there is none. */
function hardSlice(text: string, maxTokens: number, out: string[]): void {
  // Use this piece's own character-to-token ratio, so a Devanagari run is cut
  // at roughly half the characters of a Latin one.
  const perToken = Math.max(1, text.length / Math.max(1, estimateTokens(text)));
  const budget = Math.max(80, Math.floor(maxTokens * perToken));

  let rest = text;
  while (rest.length > budget) {
    const window = rest.slice(0, budget);
    const cut = window.lastIndexOf(' ') > budget * 0.6 ? window.lastIndexOf(' ') : budget;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
}

/** The final `overlapTokens` worth of a chunk, cut on a word boundary. */
function tailFor(text: string, overlapTokens: number): string {
  if (overlapTokens <= 0) return '';
  const perToken = Math.max(1, text.length / Math.max(1, estimateTokens(text)));
  const chars = Math.floor(overlapTokens * perToken);
  if (text.length <= chars) return text;
  const tail = text.slice(-chars);
  const space = tail.indexOf(' ');
  return space > 0 && space < chars / 2 ? tail.slice(space + 1) : tail;
}
