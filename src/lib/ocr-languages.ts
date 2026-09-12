// Languages OCR can read, offered in Settings › Documents.
//
// `code` is a Tesseract language code. tesseract.js downloads the model for
// each one on demand from a CDN (~10-20MB per language, cached by the
// browser afterwards), which is why this is a choice rather than "load
// everything".
//
// `native` is the language in its own script, so someone who does not read
// English can still find theirs. Deliberately the same ten languages as the
// voice picker, so the two settings read as one idea.
//
// NATIVE APPS: ML Kit on Android and iOS reads Latin script only in the
// package we bundle today. Devanagari and the other Indic recognisers are
// separate ML Kit artifacts that need a native build to add, so on a phone
// app these languages will fall back to Latin until that lands. The web
// build — which is what everyone uses right now — has no such limit.

export interface OcrLanguage {
  code: string;
  native: string;
  english: string;
  /** False where ML Kit's bundled Latin recogniser cannot read the script. */
  nativeApp: boolean;
}

export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: 'eng', native: 'English',    english: 'English',   nativeApp: true },
  { code: 'hin', native: 'हिन्दी',       english: 'Hindi',     nativeApp: false },
  { code: 'ben', native: 'বাংলা',       english: 'Bengali',   nativeApp: false },
  { code: 'tam', native: 'தமிழ்',       english: 'Tamil',     nativeApp: false },
  { code: 'tel', native: 'తెలుగు',      english: 'Telugu',    nativeApp: false },
  { code: 'mar', native: 'मराठी',       english: 'Marathi',   nativeApp: false },
  { code: 'guj', native: 'ગુજરાતી',      english: 'Gujarati',  nativeApp: false },
  { code: 'kan', native: 'ಕನ್ನಡ',       english: 'Kannada',   nativeApp: false },
  { code: 'mal', native: 'മലയാളം',    english: 'Malayalam', nativeApp: false },
  { code: 'pan', native: 'ਪੰਜਾਬੀ',      english: 'Punjabi',   nativeApp: false },
];

export const DEFAULT_OCR_LANGUAGES = ['eng'];

/**
 * The list OCR should actually load: the person's choice, with English always
 * present. Indian documents are almost always bilingual — a passport, a PAN
 * card, an insurance policy all carry English alongside the regional script —
 * and reading a page with only the regional model loses every English word on
 * it. Order matters to Tesseract, so the chosen languages lead.
 */
export function resolveOcrLanguages(chosen: string[] | undefined): string[] {
  const known = new Set(OCR_LANGUAGES.map(l => l.code));
  const picked = (chosen ?? []).filter(c => known.has(c));
  const withoutEnglish = picked.filter(c => c !== 'eng');
  return [...withoutEnglish, 'eng'];
}

/** "हिन्दी, English" — for the settings row, in the reader's own scripts. */
export function describeOcrLanguages(chosen: string[] | undefined): string {
  const codes = resolveOcrLanguages(chosen);
  return codes
    .map(c => OCR_LANGUAGES.find(l => l.code === c)?.native ?? c)
    .join(', ');
}

/** Languages the bundled native recogniser cannot read. Empty on web. */
export function unsupportedOnNativeApp(chosen: string[] | undefined): OcrLanguage[] {
  return OCR_LANGUAGES.filter(l => !l.nativeApp && (chosen ?? []).includes(l.code));
}
