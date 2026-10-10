// ─── What kind of document is this? ─────────────────────────────
//
// The built-in categories (document_categories rows with is_system, seeded by
// migration 003 and later), the order Upload shows them in, and a suggestion
// from a file's name and whatever text the app has read off it. Upload
// pre-picks only a suggestion, never the first category in a list: that
// default once made every unsorted document a "Bank Statements". Pure, so the
// QA self-test pins the rules in Node.
// ────────────────────────────────────────────────────────────────

/** Every built-in category, by its name in document_categories. */
export const BUILT_IN_CATEGORIES = [
  'Passport', 'National ID / Aadhaar', 'PAN Card', 'Driving License', 'Voter ID',
  'Health Insurance', 'Vehicle Insurance', 'Life Insurance',
  'Bank Statements', 'Tax Returns', 'Property Documents', 'Medical Records', 'Prescriptions',
  'Birth Certificate', 'Marriage Certificate', 'Death Certificate',
  'Educational Certificates', 'Employment Letters', 'Legal Documents',
  'Utility Bills', 'Visa / Travel Docs', 'Warranty Cards', 'Other',
] as const;

export type BuiltInCategory = typeof BUILT_IN_CATEGORIES[number];

/** Shown first on Upload; the rest sit behind "More". */
export const COMMON_CATEGORIES: readonly BuiltInCategory[] = [
  'Passport', 'National ID / Aadhaar', 'PAN Card', 'Driving License',
  'Health Insurance', 'Vehicle Insurance', 'Bank Statements', 'Tax Returns',
  'Property Documents', 'Medical Records',
];

const isBuiltIn = (name: string): name is BuiltInCategory =>
  (BUILT_IN_CATEGORIES as readonly string[]).includes(name);

/** Upload's order: the common ones, then every other built-in, then a family's own. */
export function categoryOrder(name: string): number {
  const common = (COMMON_CATEGORIES as readonly string[]).indexOf(name);
  if (common >= 0) return common;
  const builtIn = (BUILT_IN_CATEGORIES as readonly string[]).indexOf(name);
  return builtIn >= 0 ? 100 + builtIn : 1000;
}

// First match wins, so the specific comes before the general: a visa names a
// passport, an income-tax return names a PAN, a rent agreement is a property
// paper before it is a legal one.
const RULES: Array<[BuiltInCategory, (t: string) => boolean]> = [
  ['Visa / Travel Docs', (t) => /\bvisa\b|boarding pass|\be-?ticket\b|\bpnr\b|\birctc\b|itinerary|electronic reservation slip/.test(t)],
  ['Passport', (t) => /\bpassport\b/.test(t)],
  ['National ID / Aadhaar', (t) => /\baadhaa?r\b|\buidai\b|unique identification authority/.test(t)],
  ['Tax Returns', (t) => /income tax return|\bitr[ -]?v?\d?\b|\bform[ -]?16\b|assessment year/.test(t)],
  ['PAN Card', (t) => /permanent account number|\bpan[ -]?card\b|\be-?pan\b/.test(t)
    || (/income tax department/.test(t) && /\b[a-z]{5}\d{4}[a-z]\b/.test(t))],
  ['Voter ID', (t) => /electors? photo identity|\bvoter[ -]?id\b|election commission of india/.test(t)],
  ['Driving License', (t) => /driving licen[cs]e|\bdriving[ -]?lic\b/.test(t)],
  ['Health Insurance', (t) => /insurance|policy|mediclaim/.test(t) && /\bhealth\b|mediclaim|hospitali[sz]ation/.test(t)],
  ['Vehicle Insurance', (t) => /insurance|policy/.test(t) && /\bvehicle\b|\bmotor\b|\bcar\b|two[ -]?wheeler/.test(t)],
  ['Life Insurance', (t) => /insurance|policy|assured/.test(t) && /\blife\b|term plan|sum assured|\blic\b/.test(t)],
  ['Bank Statements', (t) => /bank statement|account statement|statement of account|\bpassbook\b|fixed deposit/.test(t)],
  ['Utility Bills', (t) => /\b(electricity|water|gas|broadband|mobile|phone|telephone|internet|maintenance) bill\b|units consumed|gas booking|\blpg\b|water tax/.test(t)],
  ['Prescriptions', (t) => /\bprescription\b|\brx\b/.test(t)],
  ['Medical Records', (t) => /discharge summary|lab report|pathology|radiology|blood test|ha?emoglobin|\bx-?ray\b|\bmri\b|ct scan/.test(t)],
  ['Birth Certificate', (t) => /birth certificate|certificate of birth/.test(t)],
  ['Marriage Certificate', (t) => /marriage certificate|certificate of marriage/.test(t)],
  ['Death Certificate', (t) => /death certificate|certificate of death/.test(t)],
  ['Educational Certificates', (t) => /mark ?sheet|marks statement|degree certificate|provisional certificate|\bcbse\b|\bicse\b|transcript|\bdiploma\b/.test(t)],
  ['Employment Letters', (t) => /offer letter|appointment letter|relieving letter|experience letter|salary slip|pay ?slip/.test(t)],
  ['Property Documents', (t) => /sale deed|gift deed|lease deed|rent(al)? agreement|\bkhata\b|property tax|encumbrance/.test(t)],
  ['Legal Documents', (t) => /affidavit|power of attorney|last will|\bnotar(y|ised|ized)\b|court order/.test(t)],
  ['Warranty Cards', (t) => /warranty|guarantee card/.test(t)],
];

/**
 * The built-in category a document most likely is, from its file name and
 * any text read off it, or null when nothing says. Only a suggestion: the
 * person sees it picked and can change it.
 */
export function suggestCategory(fileName: string | null | undefined, text?: string | null): BuiltInCategory | null {
  const name = (fileName ?? '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_.\-+]+/g, ' ');
  const body = (text ?? '').slice(0, 6000);
  const t = `${name}\n${body}`.toLowerCase().replace(/\s+/g, ' ');
  if (!t.trim()) return null;
  for (const [category, matches] of RULES) {
    if (matches(t)) return category;
  }
  return null;
}

/** A category's name for counting: built-in names as they are, anything else "Other". */
export function countedCategory(name: string | null | undefined, isSystem?: boolean | null): string {
  if (!name) return 'None';
  return isSystem !== false && isBuiltIn(name) ? name : 'Other';
}
