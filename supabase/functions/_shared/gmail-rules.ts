// ─── Gmail import: the decisions that need no network ───────────
//
// Pure functions only — no Deno globals, no fetch — so the QA self-test
// imports this file straight into Node, as it does metadata.ts.
//
//   attachmentParts      the parts of one Gmail message worth looking at
//   classifyAttachment   suggest it, maybe, or probably not — and a category
//   allowedReturnOrigin  where Google's answer may be sent back to
//   storageFileName      a name safe to use in a storage path
//   sniffType            what the bytes say the file is, whatever its name
//
// No model reads anyone's email here. Gmail's own search makes the first cut
// (SCAN_QUERY), these rules sort what comes back, and the person decides:
// a wrong guess costs a checkbox, never a lost document.
// ────────────────────────────────────────────────────────────────

/**
 * Gmail's search does the first, free cut: messages with a PDF or photo
 * attached, never promotions or social. Sent mail is included on purpose —
 * the passport scan once emailed to a visa agent is often the best copy
 * anyone has.
 */
export const SCAN_QUERY =
  'has:attachment -category:promotions -category:social -in:chats (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png)';

/** Larger attachments are listed but not imported: the documents bucket's limit (050; 15 MB here before). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export type Suggestion = 'suggested' | 'maybe' | 'unlikely';

/** The slice of Gmail's message payload the scan asks for. */
export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface FoundPart {
  partId: string;
  /** Changes on every fetch: use it at once, never store it. */
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  /** Placed in the email's body (a logo, a pasted image) rather than attached. */
  inline: boolean;
}

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};
const SUPPORTED = new Set(Object.values(TYPES));

/** Case-insensitive header lookup. */
export function header(headers: GmailPart['headers'], name: string): string | undefined {
  const wanted = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === wanted)?.value;
}

/** The type AskLocker stores this as, or null. The extension wins: mail
 *  clients often label a PDF application/octet-stream. */
function supportedType(fileName: string, mimeType?: string): string | null {
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  if (TYPES[ext]) return TYPES[ext];
  const mime = (mimeType ?? '').toLowerCase();
  return SUPPORTED.has(mime) ? mime : null;
}

/**
 * Every downloadable PDF, JPEG or PNG in a message, at any depth — a
 * forwarded email nests its attachments a level or two down.
 */
export function attachmentParts(payload: GmailPart | undefined): FoundPart[] {
  const found: FoundPart[] = [];
  const walk = (part: GmailPart | undefined, depth: number) => {
    if (!part || depth > 8) return;
    const fileName = (part.filename ?? '').trim();
    const attachmentId = part.body?.attachmentId;
    if (fileName && attachmentId && part.partId != null) {
      const mimeType = supportedType(fileName, part.mimeType);
      if (mimeType) {
        found.push({
          partId: part.partId,
          attachmentId,
          fileName,
          mimeType,
          size: part.body?.size ?? 0,
          inline: /^\s*inline/i.test(header(part.headers, 'content-disposition') ?? '')
            || !!header(part.headers, 'content-id'),
        });
      }
    }
    for (const child of part.parts ?? []) walk(child, depth + 1);
  };
  walk(payload, 0);
  return found;
}

// ─── Classification ─────────────────────────────────────────────

export interface AttachmentFacts {
  fileName: string;
  mimeType: string;
  size: number;
  inline: boolean;
  from: string;
  subject: string;
  labelIds?: string[];
}

export interface Classification {
  suggestion: Suggestion;
  /** Why, in a few words the review screen shows. */
  reason: string;
  /** One of the system categories (document_categories.name), or null. */
  category: string | null;
}

// Words that name a kind of document, in file names and subjects. Checked in
// order; the first match decides the category. Spaces pad both sides, so
// "pan" matches "PAN_card.pdf" but not "company" or "japan".
const DOCUMENT_WORDS: [RegExp, string | null, string][] = [
  [/ passports? /, 'Passport', 'passport'],
  [/ (e ?)?aa?dh?aa?r /, 'National ID / Aadhaar', 'Aadhaar'],
  [/ pan( card)? /, 'PAN Card', 'PAN'],
  [/ driving (licen[cs]e) | dl /, 'Driving License', 'driving licence'],
  [/ voter( id)? | epic card /, 'Voter ID', 'voter ID'],
  [/ birth certificate /, 'Birth Certificate', 'birth certificate'],
  [/ marriage certificate /, 'Marriage Certificate', 'marriage certificate'],
  [/ death certificate /, 'Death Certificate', 'death certificate'],
  [/ visas? | e ?tickets? | boarding pass | itinerary | pnr /, 'Visa / Travel Docs', 'travel'],
  [/ (health|mediclaim|medical) (insurance|policy|cover) | mediclaim /, 'Health Insurance', 'health insurance'],
  [/ (motor|car|bike|two wheeler|vehicle) (insurance|policy) /, 'Vehicle Insurance', 'vehicle insurance'],
  [/ (life|term) (insurance|policy|plan) | lic /, 'Life Insurance', 'life insurance'],
  [/ itr | form ?16 | (form ?)?26 ?as | income tax | tax return /, 'Tax Returns', 'tax'],
  [/ (sale|gift|lease) deed | property tax | khata | registry | allotment letter /, 'Property Documents', 'property'],
  [/ (bank|account|card|credit card|loan|demat|mutual fund) statements? | statements? | passbook /, 'Bank Statements', 'statement'],
  [/ prescriptions? /, 'Prescriptions', 'prescription'],
  [/ (lab|test|blood|diagnostic|medical|radiology) reports? | discharge summary /, 'Medical Records', 'medical report'],
  [/ marksheets? | mark sheet | transcripts? | degree | diploma /, 'Educational Certificates', 'education'],
  [/ offer letter | appointment letter | relieving letter | experience letter | payslips? | pay slip | salary slip /, 'Employment Letters', 'employment'],
  [/ (electricity|water|gas|broadband|internet|postpaid|mobile|phone) bill | bill /, 'Utility Bills', 'bill'],
  [/ warranty | guarantee card /, 'Warranty Cards', 'warranty'],
  [/ (rent|rental|lease|leave and licen[cs]e) agreement | affidavit | power of attorney /, 'Legal Documents', 'agreement'],
  [/ (insurance )?polic(y|ies) | policy schedule | premium (receipt|notice) | insurance /, null, 'insurance'],
  [/ certificate | receipt | invoice /, null, 'receipt'],
];

// Mail that is selling something. An offer LETTER and a sale DEED are
// documents, not marketing.
const MARKETING = / newsletter | offers? (?!letter )| sale (?!deed )| discount | deals? | catalog(ue)? | brochure | flyer | menu | promo(tion)? | webinar | event pass /;

// Issuers whose attachments are documents almost by definition: banks,
// insurers, depositories and fund registrars, government. The domain must
// end with one of these (a subdomain is fine, a lookalike is not).
const ISSUERS: [string, string][] = [
  ['gov.in', 'government'], ['nic.in', 'government'],
  ['hdfcbank.com', 'bank'], ['hdfcbank.net', 'bank'], ['icicibank.com', 'bank'], ['sbi.co.in', 'bank'],
  ['onlinesbi.sbi', 'bank'], ['axisbank.com', 'bank'], ['kotak.com', 'bank'], ['yesbank.in', 'bank'],
  ['idfcfirstbank.com', 'bank'], ['indusind.com', 'bank'], ['pnb.co.in', 'bank'], ['bankofbaroda.com', 'bank'],
  ['canarabank.com', 'bank'], ['unionbankofindia.co.in', 'bank'], ['federalbank.co.in', 'bank'],
  ['nsdl.co.in', 'depository'], ['nsdl.com', 'depository'], ['cdslindia.com', 'depository'],
  ['camsonline.com', 'fund registrar'], ['kfintech.com', 'fund registrar'],
  ['licindia.in', 'insurer'], ['hdfclife.com', 'insurer'], ['iciciprulife.com', 'insurer'], ['sbilife.co.in', 'insurer'],
  ['maxlifeinsurance.com', 'insurer'], ['hdfcergo.com', 'insurer'], ['icicilombard.com', 'insurer'],
  ['starhealth.in', 'insurer'], ['nivabupa.com', 'insurer'], ['careinsurance.com', 'insurer'],
  ['tataaig.com', 'insurer'], ['bajajallianz.co.in', 'insurer'], ['policybazaar.com', 'insurer'],
  ['irctc.co.in', 'travel'], ['airindia.com', 'travel'], ['goindigo.in', 'travel'],
];

/** "Name <user@example.com>" → "example.com". */
export function senderDomain(from: string): string {
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  return (address.split('@')[1] ?? '').trim().toLowerCase().replace(/[>\s]+$/, '');
}

function issuer(domain: string): string | null {
  for (const [suffix, kind] of ISSUERS) {
    if (domain === suffix || domain.endsWith(`.${suffix}`)) return kind;
  }
  return null;
}

/** " words joined by single spaces " — lowercase, letters and digits only. */
function words(text: string): string {
  return ` ${text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ')} `;
}

/**
 * Suggest it, maybe, or probably not — or null for things that are never a
 * document: a logo, a signature image, a tracking pixel.
 */
export function classifyAttachment(f: AttachmentFacts): Classification | null {
  const isImage = f.mimeType.startsWith('image/');
  const base = f.fileName.replace(/\.[^.]+$/, '');

  // Email furniture, not documents.
  if (isImage && f.size > 0 && f.size < 20_000) return null;
  if (isImage && f.inline && /^image\d{3}$/i.test(base)) return null; // Outlook's pasted images
  if (isImage && f.size < 200_000 && /(^|[^a-z])(logo|banner|signature|footer|header|spacer|icon)([^a-z]|$)/i.test(base)) return null;

  const name = words(base);
  const subject = words(f.subject);
  const domain = senderDomain(f.from);
  const from = issuer(domain);

  // The file name is strong evidence; the subject is weaker, but evidence.
  const named = matchWords(name);
  const about = named ? null : matchWords(subject);
  const category = (named ?? about)?.category ?? (from === 'bank' ? 'Bank Statements' : null);

  if (f.size > MAX_IMPORT_BYTES) {
    return { suggestion: 'unlikely', reason: `larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB`, category };
  }
  const labels = f.labelIds ?? [];
  if (labels.some((l) => l === 'CATEGORY_PROMOTIONS' || l === 'CATEGORY_SOCIAL' || l === 'CATEGORY_FORUMS')) {
    return { suggestion: 'unlikely', reason: 'promotional mail', category };
  }
  if (MARKETING.test(subject) || MARKETING.test(name)) {
    return { suggestion: named ? 'maybe' : 'unlikely', reason: 'looks like marketing', category };
  }
  if (named) return { suggestion: 'suggested', reason: `file name says ${named.label}`, category };
  if (from) return { suggestion: 'suggested', reason: `from ${a(from)} (${domain})`, category };
  if (about) return { suggestion: 'maybe', reason: `email is about ${about.label}`, category };
  if (isImage && f.inline) return { suggestion: 'unlikely', reason: 'a picture in the body of an email', category };
  return { suggestion: 'maybe', reason: isImage ? 'a photo attachment' : 'a PDF attachment', category };
}

function matchWords(text: string): { category: string | null; label: string } | null {
  for (const [pattern, category, label] of DOCUMENT_WORDS) {
    if (pattern.test(text)) return { category, label };
  }
  return null;
}

const a = (kind: string) => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);

// ─── Where Google's answer may go ───────────────────────────────

/**
 * The origin to send the browser back to, or null if it is not allowed.
 *
 * `configured` is the GMAIL_RETURN_ORIGINS secret: exact origins, separated
 * by commas; `*` stands for one run of letters, digits and hyphens inside a
 * host name. Local development (http://localhost, http://127.0.0.1) is
 * always allowed — a browser sent there stays on the person's own machine.
 *
 * This is half of what keeps a Gmail token with the right person: Google's
 * code only ever lands on a AskLocker page, never on one someone else
 * controls. The other half is that only the account that pressed "Connect"
 * can finish (gmail-connect).
 */
export function allowedReturnOrigin(origin: unknown, configured: string): string | null {
  if (typeof origin !== 'string' || !origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const clean = `${url.protocol}//${url.host}`.toLowerCase();
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return clean;
  if (url.protocol !== 'https:') return null;
  for (const entry of configured.split(',').map((s) => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean)) {
    const pattern = new RegExp(`^${entry.split('*').map(escapeRe).join('[a-z0-9-]+')}$`);
    if (pattern.test(clean)) return clean;
  }
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Storing the file ───────────────────────────────────────────

/** What the bytes are, whatever the file name claims. */
export function sniffType(bytes: Uint8Array): 'pdf' | 'jpg' | 'png' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  // "%PDF-" may follow a little junk; readers accept it within the first 1 KB.
  const head = bytes.subarray(0, Math.min(bytes.length, 1024));
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return 'pdf';
  }
  return null;
}

/**
 * A storage-safe file name with the extension the bytes deserve. The
 * document keeps its real name for display; only the path is cleaned.
 */
export function storageFileName(fileName: string, kind: 'pdf' | 'jpg' | 'png'): string {
  const base = fileName
    .replace(/\.[^.]*$/, '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  return `${base || 'document'}.${kind}`;
}
