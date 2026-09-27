// Offline proof that every fixture reads the way the tests assume — before
// a single network call, Groq token or OCR request is spent.
//
//   npm run check:fixtures
//
// It reads each PDF with the SAME code the server uses: pdfjs-serverless at
// the version _shared/pdf-text.ts imports, and reconstructLayout() and
// chunkText() imported straight from supabase/functions/_shared/ (Node 22
// strips their TypeScript types). So "the fact is in the text" here means
// the fact is in the text ingest-document will store, not in some other
// reader's idea of it.
//
// What it checks, per kind:
//   text-pdf    every page clears the server's text-layer threshold, every
//               fact is present, every `rows` group shares one line
//   scan-pdf    every page is BELOW the threshold (so the server sends it to
//               OCR) and the only text is the stamp; ≤ 1 MB and ≤ 3 pages,
//               or OCR.space's free tier refuses it
//   photo       a JPEG ≤ 1 MB
//   locked-pdf  refuses to open without the password, and opens with it

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-serverless';
import { documents } from '../fixtures/documents.mjs';
import { reconstructLayout } from '../../supabase/functions/_shared/pdf-text.ts';
import { chunkText } from '../../supabase/functions/_shared/chunking.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = join(HERE, '..', 'fixtures', 'files');
const OUT = join(HERE, '..', 'out');
const INGEST_SRC = join(HERE, '..', '..', 'supabase', 'functions', '_shared', 'ingest.ts');

// Read from the server's source rather than copied, so the two cannot drift.
const MIN_CHARS_PER_PAGE = Number(
  /const MIN_CHARS_PER_PAGE = (\d+)/.exec(readFileSync(INGEST_SRC, 'utf8'))?.[1] ?? NaN,
);
if (!Number.isFinite(MIN_CHARS_PER_PAGE)) {
  console.error('Could not find MIN_CHARS_PER_PAGE in _shared/ingest.ts — has it been renamed?');
  process.exit(1);
}

const OCR_SPACE_MAX_BYTES = 1024 * 1024;
const OCR_SPACE_MAX_PAGES = 3;

const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** Per-page text exactly as extractPdfLayoutText() builds it. */
async function readPdf(bytes, password) {
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    password,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const pieces = content.items
      .filter((item) => typeof item.str === 'string')
      .map((item) => {
        const t = item.transform ?? [1, 0, 0, 10, 0, 0];
        return { str: item.str, x: t[4], y: t[5], width: item.width ?? 0, height: Math.abs(t[3]) || item.height || 10, hasEOL: item.hasEOL };
      });
    pages.push(reconstructLayout(pieces));
  }
  return pages;
}

async function check(doc) {
  const path = join(FILES, doc.file);
  const bytes = readFileSync(path);
  const size = statSync(path).size;
  const problems = [];
  const notes = [];

  if (doc.kind === 'photo') {
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) problems.push('not a JPEG');
    if (size > OCR_SPACE_MAX_BYTES) problems.push(`${size} bytes is over OCR.space's free 1 MB limit`);
    notes.push(`${Math.round(size / 1024)} KB, read by server OCR`);
    return { problems, notes };
  }

  if (doc.kind === 'locked-pdf') {
    try {
      await readPdf(bytes);
      problems.push('opened WITHOUT a password — it is not actually locked');
    } catch (err) {
      if (!/password/i.test(String(err?.name) + String(err?.message))) problems.push(`failed for the wrong reason: ${err?.message}`);
    }
    const text = squash((await readPdf(bytes, doc.password)).join('\n'));
    for (const fact of doc.facts ?? []) if (!text.includes(squash(fact))) problems.push(`with the password, missing: ${fact}`);
    notes.push('locked; opens with its password');
    return { problems, notes };
  }

  const pages = await readPdf(bytes);
  const perPage = pages.map((p) => p.trim().length);

  if (doc.kind === 'scan-pdf') {
    if (pages.length > OCR_SPACE_MAX_PAGES) problems.push(`${pages.length} pages; OCR.space's free tier reads only ${OCR_SPACE_MAX_PAGES}`);
    if (size > OCR_SPACE_MAX_BYTES) problems.push(`${size} bytes is over OCR.space's free 1 MB limit`);
    perPage.forEach((chars, i) => {
      if (chars >= MIN_CHARS_PER_PAGE) problems.push(`page ${i + 1} has ${chars} characters of text — the server would treat it as a text layer and never OCR it`);
    });
    const text = squash(pages.join(' '));
    if (doc.stamp && !text.includes(squash(doc.stamp))) problems.push('the signature stamp is missing from the text layer');
    notes.push(`text layer ${perPage.join('/')} chars/page (stamp only) → OCR`);
    return { problems, notes };
  }

  // text-pdf
  perPage.forEach((chars, i) => {
    if (chars < MIN_CHARS_PER_PAGE) problems.push(`page ${i + 1} has only ${chars} characters — the server would treat it as a scan`);
  });
  const text = squash(pages.join('\n\n'));
  for (const fact of doc.facts ?? []) if (!text.includes(squash(fact))) problems.push(`missing fact: ${fact}`);
  const lines = pages.join('\n').split('\n').map(squash);
  for (const row of doc.rows ?? []) {
    if (!lines.some((line) => row.every((cell) => line.includes(squash(cell))))) {
      problems.push(`table row lost: [${row.join(' | ')}] no longer share a line`);
    }
  }
  const chunks = chunkText(pages.join('\n\n'));
  notes.push(`${pages.length} page(s), ${Math.min(...perPage)}+ chars/page, ${chunks.length} chunk(s)`);
  // Soft: a known limitation of the reader, reported rather than failed, so
  // it stays visible without blocking every run until someone fixes it.
  const canaries = doc.canaryWords ?? [];
  const lost = canaries.filter((w) => !text.includes(squash(w)));
  const warnings = lost.length
    ? [`known issue: ${lost.length} of ${canaries.length} Hindi words lost in the server's text layer (${lost.join(', ')})`]
    : canaries.length ? ['Hindi words now survive the text layer — the known issue looks fixed; promote canaryWords to facts'] : [];
  return { problems, notes, pages, warnings };
}

async function main() {
  let failures = 0;
  const allWarnings = [];
  const verbose = process.argv.includes('--verbose');
  for (const doc of documents) {
    let result;
    try {
      result = await check(doc);
    } catch (err) {
      result = { problems: [`could not be read: ${err?.message ?? err}`], notes: [] };
    }
    const ok = result.problems.length === 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${doc.file}  — ${result.notes.join('; ')}`);
    for (const p of result.problems) console.log(`        ✗ ${p}`);
    for (const w of result.warnings ?? []) {
      console.log(`        ⚠ ${w}`);
      allWarnings.push(`${doc.file}: ${w}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Fixture ${doc.file}::${w}`);
    }
    if (verbose && result.pages) console.log(result.pages.map((p, i) => `  ── page ${i + 1}\n${p}`).join('\n'));
  }
  // Handed to run.mjs, so the known issues appear in the run's summary too.
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'fixture-warnings.json'), JSON.stringify(allWarnings, null, 2));
  if (failures) {
    console.error(`\n${failures} fixture(s) would not test what they claim to.`);
    process.exit(1);
  }
  console.log(`\nAll ${documents.length} fixtures read as the tests expect (threshold ${MIN_CHARS_PER_PAGE} chars/page, from _shared/ingest.ts).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
