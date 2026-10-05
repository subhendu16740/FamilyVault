// ─── Metadata extraction: dates, ID numbers, amounts ────────────
//
// Pure functions of the extracted text, kept apart from ingest.ts (which
// reads secrets at load time) so they can be tested without a Deno runtime:
// qa/tools/selftest.mjs imports this file directly, and the expiry date it
// finds is what the expiry alerts and notifications are built from.
// ────────────────────────────────────────────────────────────────

export interface ExtractedMeta {
  key: string;
  value: string;
  confidence: number;
}

export function extractMetadata(text: string): ExtractedMeta[] {
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
  // Each pattern contributes its first match, and the date is its capture
  // group. These used to re-match the whole hit with a looser date regex
  // instead, and the looser regex is what cut dates short.
  const addFirstDate = (key: string, confidence: number, patterns: RegExp[]) => {
    for (const re of patterns) {
      const m = text.match(re);
      if (m?.[1]) addMeta(key, m[1], confidence);
    }
  };

  // Expiry / validity dates
  addFirstDate('expiry_date', 0.85, [
    /(?:expir(?:y|ation|es)|valid\s*(?:until|thru|through|till|upto)|exp\.?\s*date|date\s*of\s*expir)[:\s]*(\d{1,2}[\s/\-\.]\d{1,2}[\s/\-\.]\d{2,4})/i,
    // Year first. The year must be four digits and end there: with \d{2,4}
    // this also matched "17/10/2026" — as "17/10/20" — so every DD/MM/YYYY
    // expiry was stored twice, once truncated, and the document viewer showed
    // both.
    /(?:expir(?:y|ation|es)|valid\s*(?:until|thru))[:\s]*(\d{4}[\s/\-\.]\d{1,2}[\s/\-\.]\d{1,2})(?!\d)/i,
    /(?:expir(?:y|ation)|valid\s*(?:until|thru))[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i,
  ]);

  // Date of birth
  addFirstDate('date_of_birth', 0.85, [
    /(?:date\s*of\s*birth|d\.?o\.?b\.?|born\s*on|birth\s*date)[:\s]*(\d{1,2}[\s/\-\.]\d{1,2}[\s/\-\.]\d{2,4})/i,
    /(?:date\s*of\s*birth|d\.?o\.?b\.?)[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i,
  ]);

  // Date of issue
  addFirstDate('issue_date', 0.8, [
    /(?:date\s*of\s*issue|issued?\s*(?:on|date))[:\s]*(\d{1,2}[\s/\-\.]\d{1,2}[\s/\-\.]\d{2,4})/i,
    /(?:date\s*of\s*issue|issued?\s*(?:on|date))[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i,
  ]);

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

export function parseFlexibleDate(dateStr: string): string | null {
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
