// ─── The document ingestion pipeline ────────────────────────────
//
// Download → extract text → chunk → embed → store → expiry alert.
//
// Shared, not owned by the ingest-document function, because the same
// pipeline has to run from two places. Uploading a document is one. The
// other is retrying one that never finished: this vault held a PDF stuck
// at ingestion_status 'pending' for a month — the file intact in storage,
// simply never read — and nothing retried it or said so.
//
// A retry needs the whole pipeline, not part of it, so the pipeline lives
// here and both callers are thin: ingest-document checks the caller and
// calls in, the rebuild in _shared/reembed.ts does the same for documents
// it finds unindexed.
// ────────────────────────────────────────────────────────────────

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { embedPassages } from './embeddings.ts';
import { chunkText } from './chunking.ts';
import { extractPdfLayoutText } from './pdf-text.ts';

/** Bumped when extraction changes enough that stored text should be redone. */
export const EXTRACTOR_VERSION = 'pdfjs-layout-2';

/**
 * Below this many characters per page, a PDF has no real text layer and is a
 * scan that needs OCR.
 *
 * The test used to be "more than 50 characters in the whole document", which
 * a single digital-signature stamp clears. "Harrier Insurance 2026-27.pdf"
 * sat in this vault for a month looking successfully ingested on the
 * strength of 149 characters that read, in their entirety:
 *
 *     Digitally Signed by: … Date: 13/08/2026 Location: Mumbai
 *
 * The policy itself is a scan, and OCR was never even attempted, because by
 * the old rule the file had text. A page carrying real prose or a table runs
 * to hundreds of characters; a stamp runs to a few dozen, and averaging over
 * the document keeps one sparse page from condemning a good file.
 *
 * Set above the stamp rather than just above nothing: that policy's 149
 * characters clear a threshold of 100 if the file turns out to be a single
 * page, and the whole point is that it must not. Sending a genuinely sparse
 * page to OCR costs one request and nothing else, because the OCR result is
 * only kept when it reads MORE than the text layer did.
 */
const MIN_CHARS_PER_PAGE = 200;

/** Whether extracted text is substantial enough to be a real text layer. */
function hasTextLayer(text: string, pages?: number): boolean {
  const chars = text.trim().length;
  // Pages unknown (PDF.js could not open the file): fall back to the old
  // absolute rule, which is all there is to go on.
  if (!pages || pages < 1) return chars > 50;
  return chars / pages >= MIN_CHARS_PER_PAGE;
}

const OCR_SPACE_API_KEY = Deno.env.get('OCR_SPACE_API_KEY') ?? '';

export interface IngestRequest {
  familyId: string;
  documentId: string;
  storagePath: string;
  /** Text the client already extracted (Tesseract on web, ML Kit on native). */
  providedText?: string;
}

export interface IngestResult {
  chunks: number;
  metadata: number;
  extractedChars: number;
  /** True when nothing readable came out of the file. */
  empty: boolean;
  embedError?: string;
  /** Why the file could not be read, in words a person can act on. */
  reason?: string;
  /**
   * True when the failure is configuration, not the document: OCR was needed
   * and no key is set. Such a file must NOT be marked permanently failed —
   * setting the secret fixes it, and marking it would bury it for good.
   */
  retryable?: boolean;
}

/**
 * Run the pipeline for one document. Throws only on a failure that leaves
 * the document unchanged; an unreadable file returns `empty: true` so the
 * caller can mark it rather than storing a placeholder that pollutes search.
 */
export async function ingestDocument(
  supabase: SupabaseClient,
  { familyId, documentId, storagePath, providedText }: IngestRequest,
): Promise<IngestResult> {
  console.log(`[ingest] Starting: doc=${documentId}, path=${storagePath}, pre-extracted=${!!providedText}`);

  let extractedText = '';

  if (providedText && providedText.trim().length > 0) {
    extractedText = providedText;
    console.log(`[ingest] Using pre-extracted OCR text (${extractedText.length} chars)`);
  } else {
    const { data: fileData, error: dlError } = await supabase.storage
      .from('documents')
      .download(storagePath);

    if (dlError || !fileData) {
      throw new Error(`Download failed: ${dlError?.message ?? 'No data'}`);
    }

    const fileType = storagePath.split('.').pop()?.toLowerCase() ?? '';
    if (fileType === 'pdf') {
      const pdf = await extractTextFromPdf(fileData);
      extractedText = pdf.text;
      if (pdf.layoutError) {
        console.error(`[ingest] PDF.js unavailable (${pdf.layoutError}) — tables in this document will have lost their rows`);
      }
      // A scan OCR could not read. What little text there is will be a
      // signature stamp or a form field; storing it as a passage makes the
      // document look indexed while it answers nothing, which is the exact
      // failure the placeholder chunk used to cause.
      if (pdf.thin) {
        console.warn(`[ingest] ${storagePath} is a scan with no usable text: ${pdf.ocrError}`);
        return {
          chunks: 0, metadata: 0, extractedChars: pdf.text.length, empty: true,
          reason: pdf.ocrError,
          retryable: !OCR_SPACE_API_KEY,
        };
      }
    } else if (['jpg', 'jpeg', 'png'].includes(fileType)) {
      extractedText = await extractTextFromImage(fileData);
    } else {
      extractedText = await fileData.text();
    }
  }

  // Nothing readable. Say so rather than storing "[Document: name]" as a
  // chunk: a placeholder is indistinguishable from a real passage at search
  // time, and it hides the fact that the document was never read.
  if (!extractedText.trim()) {
    console.warn(`[ingest] No text extracted from ${storagePath}`);
    return {
      chunks: 0, metadata: 0, extractedChars: 0, empty: true,
      reason: 'Nothing readable could be extracted from this file',
    };
  }

  console.log(`[ingest] Extracted ${extractedText.length} chars`);

  const chunks = chunkText(extractedText);
  console.log(`[ingest] Created ${chunks.length} chunks`);

  const { vectors: embeddings, error: embedError } = await embedPassages(chunks.map(c => c.content));
  const embedded = embeddings.filter(Boolean).length;
  if (embedError) {
    // This used to be a warning nobody saw, and every chunk in the vault
    // ended up with a NULL vector because of it. Not fatal — the document is
    // still stored and still found by keyword — but it must be visible.
    console.error(`[ingest] NO EMBEDDINGS STORED: ${embedError}`);
  }
  console.log(`[ingest] Embedded ${embedded}/${chunks.length} chunks`);

  const chunksWithEmbeddings = chunks.map((chunk, i) => ({
    ...chunk,
    embedding: embeddings[i] ? `[${embeddings[i]!.join(',')}]` : null,
  }));

  const metadata = extractMetadata(extractedText);
  console.log(`[ingest] Extracted ${metadata.length} metadata fields`);

  const { error: rpcError } = await supabase.rpc('complete_document_ingestion', {
    p_family_id: familyId,
    p_document_id: documentId,
    p_ocr_text: extractedText,
    p_chunks: chunksWithEmbeddings,
    p_metadata: metadata,
  });
  if (rpcError) throw new Error(`Ingestion RPC failed: ${rpcError.message}`);

  await createExpiryAlert(supabase, familyId, documentId, metadata);

  console.log(`[ingest] Complete: doc=${documentId}`);
  return {
    chunks: chunks.length,
    metadata: metadata.length,
    extractedChars: extractedText.length,
    empty: false,
    ...(embedError ? { embedError } : {}),
  };
}

/**
 * Read one stored document again and replace its text and chunks.
 *
 * Used when extraction itself has changed, where re-chunking is not enough:
 * documents.ocr_text is the thing that was wrong, so the file has to come
 * back out of storage. Vectors are deliberately NOT written here — the
 * embedding phase does that, and keeping the two apart means a slow
 * re-extraction pass never holds up a cheap one.
 *
 * Text is stored before chunks, so a failure in between leaves the document
 * searchable on its old chunks rather than on nothing.
 */
export async function reextractDocument(
  supabase: SupabaseClient,
  schema: string,
  documentId: string,
  storagePath: string,
): Promise<{ chars: number; chunks: number; empty: boolean; extractor: PdfExtractor; layoutError?: string }> {
  const { data: fileData, error: dlError } = await supabase.storage
    .from('documents')
    .download(storagePath);
  if (dlError || !fileData) {
    throw new Error(`Download failed: ${dlError?.message ?? 'No data'}`);
  }

  const pdf: PdfText = storagePath.toLowerCase().endsWith('.pdf')
    ? await extractTextFromPdf(fileData)
    : { text: await fileData.text(), extractor: 'layout' };
  const { text, extractor, layoutError } = pdf;

  // A scan OCR could not read. Leave the document exactly as it was: its
  // existing text and chunks are no worse than what this pass produced, and
  // replacing them with a signature stamp would lose even that.
  if (pdf.thin) return { chars: text.length, chunks: 0, empty: true, extractor, layoutError };

  if (!text.trim()) return { chars: 0, chunks: 0, empty: true, extractor, layoutError };

  const chunks = chunkText(text);
  if (chunks.length === 0) return { chars: text.length, chunks: 0, empty: true, extractor, layoutError };

  const { error: textErr } = await supabase.rpc('rag_set_document_text', {
    p_schema: schema, p_document_id: documentId, p_ocr_text: text,
  });
  if (textErr) throw new Error(`Could not store text: ${textErr.message}`);

  const { error: chunkErr } = await supabase.rpc('rag_replace_document_chunks', {
    p_schema: schema,
    p_document_id: documentId,
    p_chunks: chunks.map(c => ({
      chunk_index: c.chunk_index,
      content: c.content,
      token_count: c.token_count,
      embedding: null,
    })),
  });
  if (chunkErr) throw new Error(`Could not store chunks: ${chunkErr.message}`);

  return { chars: text.length, chunks: chunks.length, empty: false, extractor, layoutError };
}

async function createExpiryAlert(
  supabase: SupabaseClient,
  familyId: string,
  documentId: string,
  metadata: ExtractedMeta[],
): Promise<void> {
  const expiryMeta = metadata.find(m => m.key === 'expiry_date');
  if (!expiryMeta) return;
  try {
    const parsedDate = parseFlexibleDate(expiryMeta.value);
    if (!parsedDate) return;
    const { error } = await supabase.rpc('create_expiry_alert', {
      p_family_id: familyId,
      p_document_id: documentId,
      p_expiry_date: parsedDate,
    });
    if (error) console.warn('[ingest] Expiry alert creation failed:', error.message);
    else console.log(`[ingest] Expiry alert created: ${parsedDate}`);
  } catch (err) {
    console.warn('[ingest] Expiry date parse failed:', err);
  }
}

// ─── Text Extraction ────────────────────────────────────────────

/**
 * Which reader produced a document's text.
 *
 * Worth reporting, because 'layout' is the only one that preserves table
 * rows and the others are indistinguishable from it once the text is
 * stored. When PDF.js cannot load at all — a broken module URL, a runtime
 * that rejects the import — EVERY PDF quietly falls through to the regex
 * parser, the same column-by-column text gets stored again, and the rebuild
 * reports success. That failure cost a full round trip to notice, so the
 * reader now says which one it was.
 */
export type PdfExtractor = 'layout' | 'regex' | 'ocr' | 'binary' | 'none';

export interface PdfText {
  text: string;
  extractor: PdfExtractor;
  /** Set when PDF.js threw, as opposed to the file simply having no text. */
  layoutError?: string;
  /** Why server-side OCR could not run, or ran and found nothing. */
  ocrError?: string;
  /** Pages PDF.js reported, when it could open the file. */
  pages?: number;
  /** True when this is a scan and OCR did not rescue it. */
  thin?: boolean;
}

async function extractTextFromPdf(blob: Blob): Promise<PdfText> {
  try {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Layout-aware first: PDF.js gives every piece of text with its position
    // on the page, which is the only way to recover table rows. Reading the
    // content stream in order — what the simple parser below does — returns a
    // table column by column, with the labels in one run and the figures in
    // another, and no question about a row can then be answered.
    let layoutError: string | undefined;
    let pages: number | undefined;
    // The best text seen so far, kept so a scan that OCR cannot rescue is
    // still stored with whatever little it had rather than with nothing.
    let best = '';
    let bestExtractor: PdfExtractor = 'none';

    try {
      const laid = await extractPdfLayoutText(bytes);
      pages = laid.pages;
      if (hasTextLayer(laid.text, pages)) {
        console.log(`[ingest] PDF layout extraction: ${laid.text.length} chars over ${pages} page(s)`);
        return { text: laid.text, extractor: 'layout', pages };
      }
      best = laid.text;
      bestExtractor = 'layout';
      console.log(
        `[ingest] PDF has no real text layer (${laid.text.trim().length} chars over ${pages} page(s)) — likely scanned`,
      );
    } catch (err) {
      // Distinguish "PDF.js broke" from "this file has no text layer". The
      // first means every PDF is about to be read the old way.
      layoutError = err instanceof Error ? err.message : String(err);
      console.warn('[ingest] Layout extraction failed, falling back:', err);
    }

    // Older regex parser: no positions, so no table structure, but it costs
    // nothing and still beats nothing if PDF.js cannot open the file.
    const text = extractPdfTextSimple(bytes);

    if (hasTextLayer(text, pages)) {
      console.log(`[ingest] PDF text parser extracted ${text.length} chars`);
      return { text, extractor: 'regex', layoutError, pages };
    }
    if (text.trim().length > best.trim().length) {
      best = text;
      bestExtractor = 'regex';
    }

    // Fallback: OCR.space, for the scans neither reader can help with.
    console.log('[ingest] No usable text layer, trying OCR.space...');
    const ocr = await ocrWithOcrSpace(blob, 'pdf');
    // Only if it read MORE than the text layer did. This is what makes a
    // wrongly-suspected page safe: a sparse but genuine page keeps its own
    // text, and only a real scan — where the text layer held a stamp and OCR
    // holds the document — is replaced.
    if (ocr.text.trim().length > 10 && ocr.text.trim().length > best.trim().length) {
      console.log(`[ingest] OCR read ${ocr.text.length} chars, beating ${best.length} from the text layer`);
      return { text: ocr.text, extractor: 'ocr', layoutError, pages };
    }
    if (ocr.text.trim().length > 10) {
      console.log(`[ingest] OCR read ${ocr.text.length} chars, no better than the ${best.length} already extracted`);
      return { text: best, extractor: bestExtractor, layoutError, pages };
    }

    // A scan that OCR could not read — or was never offered to, because no
    // key is configured. Either way the caller must be told, because the
    // stored text is a signature stamp and the document will answer nothing.
    const binary = extractReadableText(bytes);
    if (binary.trim().length > best.trim().length) {
      best = binary;
      bestExtractor = 'binary';
    }
    return {
      text: best,
      extractor: bestExtractor,
      layoutError,
      pages,
      thin: true,
      ocrError: ocr.error ?? 'OCR found no text in this scan',
    };
  } catch (err) {
    console.warn('[ingest] PDF extraction error:', err);
    return { text: '', extractor: 'none', layoutError: String(err) };
  }
}

function extractPdfTextSimple(bytes: Uint8Array): string {
  const decoder = new TextDecoder('latin1');
  const raw = decoder.decode(bytes);
  const textParts: string[] = [];

  // Extract text from PDF text objects (between BT and ET)
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match;

  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1];
    // Extract text from Tj, TJ, and ' operators
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      textParts.push(tjMatch[1]);
    }

    // TJ arrays: [(text) kern (text) kern ...]
    const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
    let arrMatch;
    while ((arrMatch = tjArrayRegex.exec(block)) !== null) {
      const innerRegex = /\(([^)]*)\)/g;
      let innerMatch;
      while ((innerMatch = innerRegex.exec(arrMatch[1])) !== null) {
        textParts.push(innerMatch[1]);
      }
    }
  }

  // Also try to find stream content that might contain text
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  while ((match = streamRegex.exec(raw)) !== null) {
    const streamContent = match[1];
    // Look for text operators in streams too
    const innerBtEt = /BT\s([\s\S]*?)ET/g;
    let innerMatch;
    while ((innerMatch = innerBtEt.exec(streamContent)) !== null) {
      const block = innerMatch[1];
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        textParts.push(tjMatch[1]);
      }
    }
  }

  return textParts
    .map(t => t.replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\\(/g, '(').replace(/\\\)/g, ')'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractReadableText(bytes: Uint8Array): string {
  // Last resort: extract any printable ASCII sequences from the binary
  const decoder = new TextDecoder('latin1');
  const raw = decoder.decode(bytes);

  const readable = raw
    .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Filter out PDF structure noise — keep only longer word sequences
  const words = readable.split(' ').filter(w => w.length > 2 && !/^[^a-zA-Z]*$/.test(w));
  return words.join(' ');
}

async function extractTextFromImage(blob: Blob): Promise<string> {
  // Use OCR.space as server-side fallback (client-side OCR is preferred)
  console.log('[ingest] Running server-side OCR for image...');
  const { text } = await ocrWithOcrSpace(blob, 'image');
  return text;
}

// ─── OCR.space API (free tier: 25K requests/month) ─────────────

/**
 * Reads the reason back to the caller as well as the text. A scan that could
 * not be OCR'd because no key is configured is an operator problem, not a
 * bad document, and the two must not look the same: one is fixed by setting
 * a secret, the other by replacing the file.
 */
async function ocrWithOcrSpace(
  blob: Blob,
  type: 'pdf' | 'image',
): Promise<{ text: string; error?: string }> {
  if (!OCR_SPACE_API_KEY) {
    console.warn('[ingest] OCR_SPACE_API_KEY is not set — skipping server-side OCR fallback');
    return { text: '', error: 'This file is a scan and needs OCR, but OCR_SPACE_API_KEY is not set on this project' };
  }

  try {
    const formData = new FormData();
    const filename = type === 'pdf' ? 'document.pdf' : 'image.jpg';
    formData.append('file', blob, filename);
    // English only, deliberately. This is the server-side fallback for PDFs
    // the text extractor could not read; OCR.space's Indic language support
    // varies by engine and an unrecognised code fails the whole request, which
    // would cost us the fallback entirely. Images are OCR'd on the client,
    // where Tesseract does read the person's chosen languages — so a scanned
    // Indian-language PDF is the one case still limited to English.
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('OCREngine', '2'); // Engine 2: better for scanned docs
    if (type === 'pdf') {
      formData.append('isTable', 'true'); // Better table extraction for receipts/invoices
    }

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        'apikey': OCR_SPACE_API_KEY,
      },
      body: formData,
    });

    if (!response.ok) {
      console.warn(`[ingest] OCR.space HTTP error: ${response.status}`);
      return { text: '', error: `OCR service returned HTTP ${response.status}` };
    }

    const result = await response.json();

    if (result.IsErroredOnProcessing) {
      console.warn('[ingest] OCR.space processing error:', result.ErrorMessage);
      return { text: '', error: `OCR service: ${String(result.ErrorMessage).slice(0, 120)}` };
    }

    // Concatenate text from all pages
    const pages = result.ParsedResults ?? [];
    const text = pages.map((p: { ParsedText: string }) => p.ParsedText).join('\n');
    console.log(`[ingest] OCR.space extracted ${text.length} chars`);
    return { text };
  } catch (err) {
    console.warn('[ingest] OCR.space failed:', err);
    return { text: '', error: `OCR service unreachable: ${String(err).slice(0, 120)}` };
  }
}

// ─── Metadata Extraction ───────────────────────────────────────

interface ExtractedMeta {
  key: string;
  value: string;
  confidence: number;
}

function extractMetadata(text: string): ExtractedMeta[] {
  const meta: ExtractedMeta[] = [];
  const seen = new Set<string>();

  const addMeta = (key: string, value: string, confidence: number) => {
    const dedupeKey = `${key}:${value}`;
    if (!seen.has(dedupeKey) && value.trim().length > 0) {
      seen.add(dedupeKey);
      meta.push({ key, value: value.trim(), confidence });
    }
  };

  // ─── Date patterns ─────────────────────────────────────────
  // Expiry / validity dates
  const expiryPatterns = [
    /(?:expir(?:y|ation|es)|valid\s*(?:until|thru|through|till|upto)|exp\.?\s*date|date\s*of\s*expir)[:\s]*(\d{1,2}[\s/\-\.]\d{1,2}[\s/\-\.]\d{2,4})/gi,
    /(?:expir(?:y|ation|es)|valid\s*(?:until|thru))[:\s]*(\d{2,4}[\s/\-\.]\d{1,2}[\s/\-\.]\d{1,2})/gi,
    /(?:expir(?:y|ation)|valid\s*(?:until|thru))[:\s]*(\d{1,2}\s+\w+\s+\d{4})/gi,
  ];
  for (const re of expiryPatterns) {
    const m = text.match(re);
    if (m) {
      // Extract just the date part
      const dateMatch = m[0].match(/(\d{1,2}[\s/\-\.]\d{1,2}[\s/\-\.]\d{2,4}|\d{2,4}[\s/\-\.]\d{1,2}[\s/\-\.]\d{1,2}|\d{1,2}\s+\w+\s+\d{4})/);
      if (dateMatch) addMeta('expiry_date', dateMatch[1], 0.85);
    }
  }

  // Date of birth
  const dobPatterns = [
    /(?:date\s*of\s*birth|d\.?o\.?b\.?|born\s*on|birth\s*date)[:\s]*(\d{1,2}[\s/\-\.]\d{1,2}[\s/\-\.]\d{2,4})/gi,
    /(?:date\s*of\s*birth|d\.?o\.?b\.?)[:\s]*(\d{1,2}\s+\w+\s+\d{4})/gi,
  ];
  for (const re of dobPatterns) {
    const m = text.match(re);
    if (m) {
      const dateMatch = m[0].match(/(\d{1,2}[\s/\-\.]\d{1,2}[\s/\-\.]\d{2,4}|\d{1,2}\s+\w+\s+\d{4})/);
      if (dateMatch) addMeta('date_of_birth', dateMatch[1], 0.85);
    }
  }

  // Date of issue
  const issuePatterns = [
    /(?:date\s*of\s*issue|issued?\s*(?:on|date))[:\s]*(\d{1,2}[\s/\-\.]\d{1,2}[\s/\-\.]\d{2,4})/gi,
    /(?:date\s*of\s*issue|issued?\s*(?:on|date))[:\s]*(\d{1,2}\s+\w+\s+\d{4})/gi,
  ];
  for (const re of issuePatterns) {
    const m = text.match(re);
    if (m) {
      const dateMatch = m[0].match(/(\d{1,2}[\s/\-\.]\d{1,2}[\s/\-\.]\d{2,4}|\d{1,2}\s+\w+\s+\d{4})/);
      if (dateMatch) addMeta('issue_date', dateMatch[1], 0.8);
    }
  }

  // ─── ID numbers ────────────────────────────────────────────

  // Passport number (letter followed by 7 digits — Indian format, or generic alphanumeric)
  const passportMatch = text.match(/(?:passport\s*(?:no|number|#)?)[:\s]*([A-Z]\d{7})/i);
  if (passportMatch) addMeta('passport_number', passportMatch[1].toUpperCase(), 0.9);

  // PAN number (Indian: 5 letters, 4 digits, 1 letter)
  const panMatch = text.match(/(?:pan|permanent\s*account)[:\s]*([A-Z]{5}\d{4}[A-Z])/i)
    || text.match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
  if (panMatch) addMeta('pan_number', panMatch[1].toUpperCase(), 0.85);

  // Aadhaar number (Indian: 12 digits, may have spaces)
  const aadhaarMatch = text.match(/(?:aadhaar|aadhar|uid)[:\s]*(\d{4}\s?\d{4}\s?\d{4})/i)
    || text.match(/\b(\d{4}\s\d{4}\s\d{4})\b/);
  if (aadhaarMatch) addMeta('aadhaar_number', aadhaarMatch[1].replace(/\s/g, ' '), 0.85);

  // Driving license number
  const dlMatch = text.match(/(?:(?:driving|driver'?s?)\s*licen[cs]e|d\.?l\.?)\s*(?:no|number|#)?[:\s]*([A-Z]{2}\d{2}\s?\d{4,11})/i);
  if (dlMatch) addMeta('driving_license_number', dlMatch[1].toUpperCase(), 0.8);

  // Policy / account number (generic)
  const policyMatch = text.match(/(?:policy|account|member(?:ship)?|certificate)\s*(?:no|number|#|id)?[:\s]*([A-Z0-9]{6,20})/i);
  if (policyMatch) addMeta('policy_number', policyMatch[1], 0.7);

  // ─── Names ─────────────────────────────────────────────────

  const nameMatch = text.match(/(?:name|holder|insured|patient)[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/);
  if (nameMatch) addMeta('holder_name', nameMatch[1], 0.7);

  // ─── Amounts ───────────────────────────────────────────────

  const amountMatch = text.match(/(?:(?:sum\s*(?:insured|assured))|(?:total|amount|premium|coverage))[:\s]*(?:(?:Rs\.?|INR|₹|\$|USD)\s*)?([\d,]+(?:\.\d{2})?)/i);
  if (amountMatch) addMeta('amount', amountMatch[1], 0.7);

  // ─── Phone numbers ────────────────────────────────────────

  const phoneMatch = text.match(/(?:phone|mobile|contact|tel)[:\s]*(\+?\d[\d\s\-]{8,14}\d)/i);
  if (phoneMatch) addMeta('phone_number', phoneMatch[1].replace(/\s/g, ''), 0.75);

  return meta;
}

// ─── Date Parsing ──────────────────────────────────────────────

function parseFlexibleDate(dateStr: string): string | null {
  // Try common date formats and return YYYY-MM-DD or null
  const cleaned = dateStr.trim().replace(/\s+/g, ' ');

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  let m = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY/MM/DD or YYYY-MM-DD
  m = cleaned.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD Mon YYYY (e.g., "15 Jul 2033")
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04',
    june: '06', july: '07', august: '08', september: '09',
    october: '10', november: '11', december: '12',
  };
  m = cleaned.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (m) {
    const mo = months[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`;
  }

  // DD/MM/YY (2-digit year)
  m = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/);
  if (m) {
    const [, d, mo, y] = m;
    const fullYear = parseInt(y) > 50 ? `19${y}` : `20${y}`;
    return `${fullYear}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}
