// Speech → text on native (Android / iOS).
//
// Not wired yet. The native engine (the phone's own recogniser, via
// expo-speech-recognition and its config plugin with microphone permission
// strings) lands in its own PR once an EAS build exists to verify it on.
// Until then native reports "unsupported" and the search screen keeps the
// keyboard; text-to-speech already works on native through expo-speech.
//
// Metro resolves speech-recognition.web.ts over this file for web.

import type { ListenHandlers } from './speech-recognition-types';

export function recognitionSupported(): boolean {
  return false;
}

export function listen(_lang: string, h: ListenHandlers): void {
  h.onError('unsupported', 'Speech recognition is not available in the native app yet');
}

export function stopListening(): void {
  // nothing to stop
}
