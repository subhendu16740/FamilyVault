// ─── FamilyVault Document Ingestion Edge Function ───────────────
// Pipeline: Download → Extract Text → Chunk → Embed → Store
// All free/open-source: pdf.js for PDFs, Tesseract for images,
// HuggingFace free Inference API for embeddings (see _shared/embeddings.ts —
// the model and its required "passage: " prefix live there, so ingest and
// search can never drift onto different models).
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireFamilyMember } from '../_shared/auth.ts';
import { embedPassages } from '../_shared/embeddings.ts';
import { chunkText, type Chunk } from '../_shared/chunking.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OCR_SPACE_API_KEY = Deno.env.get('OCR_SPACE_API_KEY') ?? ''; // supabase secrets set OCR_SPACE_API_KEY=...


const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── CORS Headers ───────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Main Handler ───────────────────────────────────────────────

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { family_id, document_id, storage_path, ocr_text } = await req.json();

    if (!family_id || !document_id || !storage_path) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    // Writes into the family's private schema on the service role: the caller
    // must be a member with upload rights, or anyone with the anon key could
    // ingest into any family whose id they know.
    const auth = await requireFamilyMember(req, supabase, family_id, { upload: true });
    if (!auth.ok) return auth.response;

    console.log(`[ingest] Starting: doc=${document_id}, path=${storage_path}, pre-extracted=${!!ocr_text}`);

    let extractedText = '';

    if (ocr_text && typeof ocr_text === 'string' && ocr_text.trim().length > 0) {
      // Use client-side OCR text (from Tesseract.js or ML Kit)
      extractedText = ocr_text;
      console.log(`[ingest] Using pre-extracted OCR text (${extractedText.length} chars)`);
    } else {
      // Fallback: server-side extraction
      // 1. Download file from Supabase Storage
      const { data: fileData, error: dlError } = await supabase.storage
        .from('documents')
        .download(storage_path);

      if (dlError || !fileData) {
        throw new Error(`Download failed: ${dlError?.message ?? 'No data'}`);
      }

      // 2. Extract text based on file type
      const fileType = storage_path.split('.').pop()?.toLowerCase() ?? '';

      if (fileType === 'pdf') {
        extractedText = await extractTextFromPdf(fileData);
      } else if (['jpg', 'jpeg', 'png'].includes(fileType)) {
        extractedText = await extractTextFromImage(fileData);
      } else {
        extractedText = await fileData.text();
      }
    }

    if (!extractedText.trim()) {
      console.warn('[ingest] No text extracted — storing empty.');
      extractedText = `[Document: ${storage_path.split('/').pop()}]`;
    }

    console.log(`[ingest] Extracted ${extractedText.length} chars`);

    // 3. Chunk the text
    const chunks = chunkText(extractedText);
    console.log(`[ingest] Created ${chunks.length} chunks`);

    // 4. Generate embeddings
    const { vectors: embeddings, error: embedError } = await embedPassages(chunks.map(c => c.content));
    const embedded = embeddings.filter(Boolean).length;
    if (embedError) {
      // This used to be a warning nobody saw, and every chunk in the vault
      // ended up with a NULL vector because of it. An error is not fatal —
      // the document is still stored and still found by keyword — but it
      // must be visible.
      console.error(`[ingest] NO EMBEDDINGS STORED: ${embedError}`);
    }
    console.log(`[ingest] Embedded ${embedded}/${chunks.length} chunks`);

    // 5. Prepare chunks with embeddings. A null vector is not fatal: the chunk
    // is still stored and still found by keyword, and the next index rebuild
    // will fill it in.
    const chunksWithEmbeddings = chunks.map((chunk, i) => ({
      ...chunk,
      embedding: embeddings[i] ? `[${embeddings[i]!.join(',')}]` : null,
    }));

    // 6. Extract metadata (dates, IDs, policy numbers, etc.)
    const metadata = extractMetadata(extractedText);
    console.log(`[ingest] Extracted ${metadata.length} metadata fields`);

    // 7. Store via RPC
    const { error: rpcError } = await supabase.rpc('complete_document_ingestion', {
      p_family_id: family_id,
      p_document_id: document_id,
      p_ocr_text: extractedText,
      p_chunks: chunksWithEmbeddings,
      p_metadata: metadata,
    });

    if (rpcError) {
      throw new Error(`Ingestion RPC failed: ${rpcError.message}`);
    }

    // 8. Create expiry alert if expiry_date was detected
    const expiryMeta = metadata.find((m: ExtractedMeta) => m.key === 'expiry_date');
    if (expiryMeta) {
      try {
        const parsedDate = parseFlexibleDate(expiryMeta.value);
        if (parsedDate) {
          const { error: alertErr } = await supabase.rpc('create_expiry_alert', {
            p_family_id: family_id,
            p_document_id: document_id,
            p_expiry_date: parsedDate,
          });
          if (alertErr) {
            console.warn('[ingest] Expiry alert creation failed:', alertErr.message);
          } else {
            console.log(`[ingest] Expiry alert created: ${parsedDate}`);
          }
        }
      } catch (err) {
        console.warn('[ingest] Expiry date parse failed:', err);
      }
    }

    console.log(`[ingest] Complete: doc=${document_id}`);
    return jsonResponse({ success: true, chunks: chunks.length, metadata: metadata.length });

  } catch (err) {
    console.error('[ingest] Error:', err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

// ─── Text Extraction ────────────────────────────────────────────

async function extractTextFromPdf(blob: Blob): Promise<string> {
  try {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Try simple PDF text extraction first (works for digital/text PDFs)
    const text = extractPdfTextSimple(bytes);

    if (text.trim().length > 50) {
      console.log(`[ingest] PDF text parser extracted ${text.length} chars`);
      return text;
    }

    // Fallback: use OCR.space API for scanned/compressed PDFs
    console.log('[ingest] Simple parser failed, trying OCR.space...');
    const ocrText = await ocrWithOcrSpace(blob, 'pdf');
    if (ocrText.trim().length > 10) {
      return ocrText;
    }

    // Last resort: extract any readable text from the binary
    return extractReadableText(bytes);
  } catch (err) {
    console.warn('[ingest] PDF extraction error:', err);
    return '';
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
  const text = await ocrWithOcrSpace(blob, 'image');
  return text || '[Image document — OCR extraction failed]';
}

// ─── OCR.space API (free tier: 25K requests/month) ─────────────

async function ocrWithOcrSpace(blob: Blob, type: 'pdf' | 'image'): Promise<string> {
  if (!OCR_SPACE_API_KEY) {
    console.warn('[ingest] OCR_SPACE_API_KEY is not set — skipping server-side OCR fallback');
    return '';
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
      return '';
    }

    const result = await response.json();

    if (result.IsErroredOnProcessing) {
      console.warn('[ingest] OCR.space processing error:', result.ErrorMessage);
      return '';
    }

    // Concatenate text from all pages
    const pages = result.ParsedResults ?? [];
    const text = pages.map((p: { ParsedText: string }) => p.ParsedText).join('\n');
    console.log(`[ingest] OCR.space extracted ${text.length} chars`);
    return text;
  } catch (err) {
    console.warn('[ingest] OCR.space failed:', err);
    return '';
  }
}

// ─── Chunking ───────────────────────────────────────────────────


// ─── Embeddings (HuggingFace Inference API) ───────────────────


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

// ─── Helpers ────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
