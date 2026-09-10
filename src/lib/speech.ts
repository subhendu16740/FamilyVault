// The one import the search screen needs for voice: hearing and speaking.
//
// Speech → text is a platform split (speech-recognition.ts / .web.ts).
// Text → speech is expo-speech on every platform: the phone's own voices on
// Android and iOS, the browser's speechSynthesis on web. Nothing here costs
// anything or sends audio to a server we run.

import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

export { recognitionSupported, listen, stopListening } from './speech-recognition';
export type { ListenHandlers, SpeechErrorCode } from './speech-recognition-types';

export interface SpeakHandlers {
  onDone?: () => void;
  onError?: (err: unknown) => void;
}

/** Read `text` aloud in `lang`. Anything already speaking is cut off first. */
export function speak(text: string, lang: string, h: SpeakHandlers = {}): void {
  if (!text.trim()) {
    h.onDone?.();
    return;
  }
  Speech.stop();
  const seq = ++speakSeq;
  // Setting `language` alone leaves the engine free to fall back to the
  // phone's default voice, which is usually English. Naming a matching voice
  // is what makes a Hindi answer come out in Hindi on most phones.
  voiceFor(lang).then(voice => {
    if (seq !== speakSeq) return; // stopped or superseded while we looked up the voice
    Speech.speak(text, {
      language: lang,
      ...(voice ? { voice } : {}),
      rate: 0.95,         // a touch slower than default — this is for older ears
      onDone: h.onDone,
      onStopped: h.onDone, // a stop is also "finished" as far as the screen cares
      onError: h.onError,
    });
  });
}

// Bumped by every speak() and stopSpeaking(), so a stop that lands while a
// voice lookup is in flight wins — nothing starts talking after "Stop".
let speakSeq = 0;
let voiceCache: Speech.Voice[] | null = null;

async function loadVoices(): Promise<Speech.Voice[]> {
  if (voiceCache && voiceCache.length > 0) return voiceCache;
  try {
    if (Platform.OS === 'web') await waitForWebVoices();
    voiceCache = await Speech.getAvailableVoicesAsync();
  } catch {
    voiceCache = [];
  }
  return voiceCache;
}

const norm = (tag: string) => tag.toLowerCase().replace('_', '-');

/** Identifier of the best voice for the language: exact region first, then any voice of the language. */
async function voiceFor(lang: string): Promise<string | undefined> {
  const voices = await loadVoices();
  const want = norm(lang);
  const base = want.split('-')[0];
  const exact = voices.find(v => norm(v.language ?? '') === want);
  const same = voices.find(v => norm(v.language ?? '').startsWith(base));
  return (exact ?? same)?.identifier || undefined;
}

export function stopSpeaking(): void {
  speakSeq++;
  Speech.stop();
}

/**
 * Whether this phone has a voice for the language. On web, Chrome fills the
 * voice list asynchronously, so we wait for it briefly; an empty list is
 * treated as "unknown" (true) rather than "no", to avoid greying out every
 * language on a phone that is merely slow to report.
 */
export async function hasVoiceFor(lang: string): Promise<boolean> {
  const voices = await loadVoices();
  if (voices.length === 0) return true;
  const base = norm(lang).split('-')[0];
  return voices.some(v => norm(v.language ?? '').startsWith(base));
}

function waitForWebVoices(): Promise<void> {
  return new Promise(resolve => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return resolve();
    if (synth.getVoices().length > 0) return resolve();
    const timer = setTimeout(done, 1000);
    function done() {
      clearTimeout(timer);
      synth?.removeEventListener('voiceschanged', done);
      resolve();
    }
    synth.addEventListener('voiceschanged', done);
  });
}
