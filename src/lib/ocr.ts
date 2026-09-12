// ─── Client-Side OCR ────────────────────────────────────────────
// Web: Tesseract.js (WASM, runs in browser)
// Android/iOS: Google ML Kit (on-device, native)
// Both are 100% free with no API limits.
//
// LANGUAGES. Tesseract reads every major Indian script, but each language
// model is a separate ~10-20MB download (fetched from a CDN on first use and
// cached by the browser afterwards), so we load only the ones the person says
// their documents use — Settings › Documents, see ocr-languages.ts. English
// is always included alongside, because Indian documents are almost always
// bilingual.
//
// ML Kit on native reads Latin script only in the package bundled today.
// Devanagari and the other Indic recognisers are separate ML Kit artifacts
// that need a native build to add, so a phone app still returns Latin-only
// text for those pages. ocrLanguageGapOnThisDevice() reports that, so the
// upload screen can say so instead of silently producing garbage.
// ────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import {
  resolveOcrLanguages,
  unsupportedOnNativeApp,
  type OcrLanguage,
} from './ocr-languages';

const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'heic', 'webp', 'bmp', 'gif', 'tiff'];

export function isImageFile(fileType: string): boolean {
  return IMAGE_TYPES.includes(fileType.toLowerCase());
}

export interface OcrProgress {
  stage: 'loading' | 'recognizing' | 'done';
  progress: number; // 0–1
  /** Set while a language model is being fetched — the slow first-run step. */
  downloading?: boolean;
}

type ProgressCallback = (p: OcrProgress) => void;

/**
 * Languages this device cannot actually read, given what the person chose.
 * Empty on web, where Tesseract handles all of them.
 */
export function ocrLanguageGapOnThisDevice(languages: string[] | undefined): OcrLanguage[] {
  if (Platform.OS === 'web') return [];
  return unsupportedOnNativeApp(languages);
}

/**
 * Extract text from an image file using client-side OCR.
 * Automatically picks the right engine based on platform.
 *
 * `languages` are the person's chosen Tesseract codes; English is added for
 * them. Omitting it reads English only, which is the old behaviour.
 */
export async function extractTextFromImage(
  imageUri: string,
  onProgress?: ProgressCallback,
  languages?: string[],
): Promise<string> {
  onProgress?.({ stage: 'loading', progress: 0 });

  if (Platform.OS === 'web') {
    return extractWithTesseract(imageUri, onProgress, resolveOcrLanguages(languages));
  } else {
    return extractWithMlKit(imageUri, onProgress);
  }
}

// ─── Web: Tesseract.js ──────────────────────────────────────────

async function extractWithTesseract(
  imageUri: string,
  onProgress?: ProgressCallback,
  languages: string[] = ['eng'],
): Promise<string> {
  const { createWorker } = await import('tesseract.js');

  onProgress?.({ stage: 'loading', progress: 0.1 });

  // tesseract.js fetches each language model from a CDN on first use, so a
  // newly chosen language costs one slow run and is instant afterwards.
  // Surface that rather than letting the bar sit still.
  const worker = await createWorker(languages, undefined, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onProgress?.({ stage: 'recognizing', progress: 0.1 + m.progress * 0.85 });
      } else if (m.status?.startsWith('loading language traineddata')
              || m.status === 'downloading language traineddata') {
        onProgress?.({ stage: 'loading', progress: 0.02 + m.progress * 0.08, downloading: true });
      }
    },
  });

  onProgress?.({ stage: 'recognizing', progress: 0.15 });

  let text = '';
  try {
    ({ data: { text } } = await worker.recognize(imageUri));
  } finally {
    // A worker that outlives a failed recognise holds on to its WASM heap,
    // and a few of those will exhaust a phone browser.
    await worker.terminate();
  }

  onProgress?.({ stage: 'done', progress: 1 });
  return text.trim();
}

// ─── Android/iOS: Google ML Kit ─────────────────────────────────

async function extractWithMlKit(
  imageUri: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  onProgress?.({ stage: 'recognizing', progress: 0.3 });

  const MlkitOcr = await import('react-native-mlkit-ocr');
  const result = await MlkitOcr.default.detectFromUri(imageUri);

  onProgress?.({ stage: 'done', progress: 1 });

  // ML Kit returns an array of text blocks, each with lines
  return result
    .map((block: { text: string }) => block.text)
    .join('\n')
    .trim();
}
