// ─── Reading a photo the way the web app does ───────────────────
//
// The web app does not leave a photo to the server's OCR, which reads
// English only. upload.tsx reads it in the browser with tesseract.js, in the
// languages chosen under Settings › Documents with English always added
// (src/lib/ocr.ts), and sends that text along with the file. So a photo of a
// Tamil bill reaches ingest-document as Tamil text.
//
// This is that step in Node: the tesseract.js version the app pins, the same
// engine mode (LSTM only, the app's default) and the same trained models the
// app fetches from jsDelivr (@tesseract.js-data/<lang>/4.0.0_best_int).
// They are installed from npm instead of fetched, so a run never depends on
// the CDN. A fixture that needs another language needs its package added to
// qa/package.json.
// ────────────────────────────────────────────────────────────────

import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorker } from 'tesseract.js';

const require = createRequire(import.meta.url);
const MODEL = '4.0.0_best_int'; // what tesseract.js loads for OEM 1 when no langPath is set

// tesseract.js reads every language from ONE directory, and each npm package
// holds one language, so the ones asked for are gathered into a temp folder.
function languageDir(languages) {
  const dir = join(tmpdir(), 'familyvault-qa-tessdata');
  mkdirSync(dir, { recursive: true });
  for (const lang of languages) {
    const file = `${lang}.traineddata.gz`;
    if (existsSync(join(dir, file))) continue;
    let pkg;
    try {
      pkg = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    } catch {
      throw new Error(`no OCR model for '${lang}': add @tesseract.js-data/${lang} to qa/package.json`);
    }
    // Copied then renamed, so a run that dies mid-copy never leaves a
    // truncated model for the next one to trust.
    const partial = join(dir, `${file}.${process.pid}.partial`);
    copyFileSync(join(pkg, MODEL, file), partial);
    renameSync(partial, join(dir, file));
  }
  return dir;
}

/** The text the web app would send with this image, for these Tesseract languages. */
export async function readLikeTheWebApp(bytes, languages) {
  const worker = await createWorker(languages, 1, {
    langPath: languageDir(languages),
    gzip: true,
    cacheMethod: 'none', // never write models into the working directory
  });
  try {
    const { data: { text } } = await worker.recognize(Buffer.from(bytes));
    return text.trim(); // as extractWithTesseract() returns it
  } finally {
    await worker.terminate();
  }
}
