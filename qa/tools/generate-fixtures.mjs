// Renders every document in fixtures/documents.mjs into fixtures/files/.
//
//   npm run fixtures            (needs the devDependencies: npm install)
//
// Chromium does the drawing, so Devanagari is shaped properly and tables are
// real tables. The outputs are committed; CI never regenerates them, it only
// checks them (tools/check-fixtures.mjs). Re-run this after editing a
// document, bump FIXTURE_VERSION and the _vN file names, and commit the files.
//
// The locked PDF is encrypted with pypdf (`pip install pypdf`), because no
// maintained JavaScript library writes PDF encryption. Set PYTHON to a
// specific interpreter if the default one lacks it.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { documents } from '../fixtures/documents.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'fixtures', 'files');
const require = createRequire(import.meta.url);

// OCR.space's free tier refuses anything larger, and scans and photos go there.
const OCR_SPACE_MAX_BYTES = 1024 * 1024;

function fontFace(family, weight, pkgFile, range) {
  const data = readFileSync(require.resolve(pkgFile)).toString('base64');
  return `@font-face { font-family: '${family}'; font-weight: ${weight}; font-style: normal;
    src: url(data:font/woff2;base64,${data}) format('woff2');${range ? ` unicode-range: ${range};` : ''} }`;
}

// Embedded as data URIs: setContent() pages cannot load file:// fonts, and
// the render must never depend on the network.
const DEVANAGARI_RANGE = 'U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+25CC, U+A830-A839, U+A8E0-A8FF';
const FONT_CSS = [
  fontFace('Noto Sans', 400, '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2'),
  fontFace('Noto Sans', 700, '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2'),
  fontFace('Noto Sans Devanagari', 400, '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2', DEVANAGARI_RANGE),
  fontFace('Noto Sans Devanagari', 700, '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff2', DEVANAGARI_RANGE),
].join('\n');

const withFonts = (html) => html.replace('<style>', `<style>${FONT_CSS}\n`);

async function render(page, html, viewport) {
  await page.setViewportSize(viewport);
  await page.setContent(withFonts(html), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
}

async function textPdf(page, html) {
  await render(page, html, { width: 794, height: 1123 });
  return page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
}

async function photoJpeg(page, html) {
  await render(page, html, { width: 1400, height: 1000 });
  return page.screenshot({ type: 'jpeg', quality: 82 });
}

// An image of the page, placed in a PDF with ONE line of real text on top:
// the signature stamp. Per page that is far below the server's 200-character
// threshold, so the document must be routed to OCR — which is the point.
async function scanPdf(page, html, stamp) {
  await render(page, html, { width: 1240, height: 1754 });
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 72 });
  const wrapper = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; } html, body { margin: 0; }
    .p { width: 210mm; height: 297mm; position: relative; overflow: hidden; }
    img { width: 210mm; height: 297mm; display: block; }
    .stamp { position: absolute; right: 12mm; bottom: 10mm; font: 7pt sans-serif; color: #1d4ed8;
             border: 1px solid #1d4ed8; padding: 3px 5px; background: rgba(255, 255, 255, 0.85); }
  </style></head><body><div class="p"><img src="data:image/jpeg;base64,${jpeg.toString('base64')}">
  <div class="stamp">${stamp}</div></div></body></html>`;
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.setContent(wrapper, { waitUntil: 'load' });
  return page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
}

function lockPdf(plain, password) {
  const dir = join(tmpdir(), `fv-fixtures-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const src = join(dir, 'plain.pdf');
  const dst = join(dir, 'locked.pdf');
  writeFileSync(src, plain);
  execFileSync(process.env.PYTHON || 'python3', [join(HERE, 'lock-pdf.py'), src, dst, password], { stdio: 'inherit' });
  const locked = readFileSync(dst);
  rmSync(dir, { recursive: true, force: true });
  return locked;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let problems = 0;

  for (const doc of documents) {
    let bytes;
    if (doc.kind === 'text-pdf') bytes = await textPdf(page, doc.html());
    else if (doc.kind === 'photo') bytes = await photoJpeg(page, doc.html());
    else if (doc.kind === 'scan-pdf') bytes = await scanPdf(page, doc.html(), doc.stamp);
    else if (doc.kind === 'locked-pdf') bytes = lockPdf(await textPdf(page, doc.html()), doc.password);
    else throw new Error(`Unknown kind ${doc.kind} for ${doc.file}`);

    const path = join(OUT, doc.file);
    writeFileSync(path, bytes);
    const size = statSync(path).size;
    const tooBig = (doc.kind === 'scan-pdf' || doc.kind === 'photo' || doc.kind === 'locked-pdf') && size > OCR_SPACE_MAX_BYTES;
    if (tooBig) problems++;
    console.log(`${tooBig ? 'TOO BIG' : 'ok     '}  ${(size / 1024).toFixed(0).padStart(5)} KB  ${doc.kind.padEnd(10)}  ${doc.file}`);
  }

  await browser.close();
  if (problems) {
    console.error(`\n${problems} file(s) exceed OCR.space's free 1 MB limit and would never be read.`);
    process.exit(1);
  }
  console.log('\nNow run: npm run check:fixtures');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
