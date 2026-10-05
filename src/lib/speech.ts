// The one import the search screen needs for voice: hearing and speaking.
//
// Speech → text is a platform split (speech-recognition.ts / .web.ts).
// Text → speech is expo-speech on every platform: the phone's own voices on
// Android and iOS, the browser's speechSynthesis on web. Nothing here costs
// anything or sends audio to a server we run.

import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { storageGet, storageRemove, storageSet } from './storage';

export { recognitionSupported, listen, stopListening } from './speech-recognition';
export type { ListenHandlers, SpeechErrorCode } from './speech-recognition-types';

export interface SpeakHandlers {
  onDone?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Read `text` aloud in `lang`, in the voice chosen for it on this device or
 * the best match. `voiceId` reads a sample in one voice instead (null: the
 * automatic one). Anything already speaking is cut off first.
 */
export function speak(text: string, lang: string, h: SpeakHandlers = {}, voiceId?: string | null): void {
  if (!text.trim()) {
    h.onDone?.();
    return;
  }
  Speech.stop();
  const seq = ++speakSeq;
  // Setting `language` alone leaves the engine free to fall back to the
  // phone's default voice, which is usually English. Naming a matching voice
  // is what makes a Hindi answer come out in Hindi on most phones.
  voiceFor(lang, voiceId).then(voice => {
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

/**
 * Identifier of the voice to read the language in: the one chosen for it on
 * this device while the device still has it, else the best match — exact
 * region first, then any voice of the language.
 */
async function voiceFor(lang: string, voiceId?: string | null): Promise<string | undefined> {
  const voices = await loadVoices();
  const wanted = voiceId === undefined ? await chosenVoice(lang) : voiceId;
  if (wanted && voices.some(v => v.identifier === wanted)) return wanted;
  const want = norm(lang);
  const base = want.split('-')[0];
  const exact = voices.find(v => norm(v.language ?? '') === want);
  const same = voices.find(v => norm(v.language ?? '').startsWith(base));
  return (exact ?? same)?.identifier || undefined;
}

// ─── Which voice reads the answers ──────────────────────────────
// Settings › Accessibility › Voice lists this device's voices for the voice
// language. The choice is kept on this device, one per language — a voice
// belongs to the phone or browser, not to the account, and a Hindi voice
// cannot read English. Automatic, or a voice the device no longer has, is the
// best match, as before.

export interface DeviceVoice {
  id: string;
  /** What to call it: its own name, or "Voice 2" when its name is only a code. */
  label: string;
  language: string;
  /** "Works offline" or "Needs internet", where the device says. */
  note?: string;
}

const voiceKey = (lang: string) => `fv:voice:${norm(lang).split('-')[0]}`;

/** This device's voices for the language, its own region first. */
export async function voicesFor(lang: string): Promise<DeviceVoice[]> {
  const voices = await loadVoices();
  const want = norm(lang);
  const base = want.split('-')[0];
  return voices
    .filter(v => norm(v.language ?? '').startsWith(base))
    .sort((a, b) =>
      Number(norm(b.language ?? '') === want) - Number(norm(a.language ?? '') === want)
      || (a.name ?? '').localeCompare(b.name ?? ''))
    .map((v, i) => {
      // Android names a voice by its code ("hi-in-x-hia-local"): number those.
      const coded = !v.name || (/^[a-z]{2,3}[-_][a-z]{2}/i.test(v.name) && !/\s/.test(v.name));
      const where = /network/i.test(v.identifier) ? 'Needs internet'
        : /local/i.test(v.identifier) ? 'Works offline' : undefined;
      return { id: v.identifier, label: coded ? `Voice ${i + 1}` : v.name, language: v.language, note: where };
    });
}

/** The voice chosen for the language on this device; null for automatic. */
export function chosenVoice(lang: string): Promise<string | null> {
  return storageGet(voiceKey(lang));
}

/** Choose the voice for the language on this device; null goes back to automatic. */
export async function chooseVoice(lang: string, voiceId: string | null): Promise<void> {
  if (voiceId) await storageSet(voiceKey(lang), voiceId);
  else await storageRemove(voiceKey(lang));
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
