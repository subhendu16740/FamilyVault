// ─── Client-Side OCR ────────────────────────────────────────────
// Web: Tesseract.js (WASM, runs in browser)
// Android/iOS: Google ML Kit (on-device, native)
// Both are 100% free with no API limits.
// ────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';

const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'heic', 'webp', 'bmp', 'gif', 'tiff'];

export function isImageFile(fileType: string): boolean {
  return IMAGE_TYPES.includes(fileType.toLowerCase());
}

export interface OcrProgress {
  stage: 'loading' | 'recognizing' | 'done';
  progress: number; // 0–1
}

type ProgressCallback = (p: OcrProgress) => void;

/**
 * Extract text from an image file using client-side OCR.
 * Automatically picks the right engine based on platform.
 */
export async function extractTextFromImage(
  imageUri: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  onProgress?.({ stage: 'loading', progress: 0 });

  if (Platform.OS === 'web') {
    return extractWithTesseract(imageUri, onProgress);
  } else {
    return extractWithMlKit(imageUri, onProgress);
  }
}

// ─── Web: Tesseract.js ──────────────────────────────────────────

async function extractWithTesseract(
  imageUri: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  const { createWorker } = await import('tesseract.js');

  onProgress?.({ stage: 'loading', progress: 0.1 });

  const worker = await createWorker('eng', undefined, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onProgress?.({ stage: 'recognizing', progress: 0.1 + m.progress * 0.85 });
      }
    },
  });

  onProgress?.({ stage: 'recognizing', progress: 0.15 });

  const { data: { text } } = await worker.recognize(imageUri);
  await worker.terminate();

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
