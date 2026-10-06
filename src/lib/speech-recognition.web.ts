// Speech → text on the web: the browser's own Web Speech API.
//
// Free, no server, and the same engine the keyboard's microphone key uses
// (Google's on Chrome, Apple's on Safari). Firefox does not implement it,
// so recognitionSupported() is false there and the screen hides the mic.
//
// One recognition at a time. `continuous` is off on purpose: the engine
// stops itself when the person pauses, which is what makes tap-to-talk work
// without the person having to time anything.

import type { ListenHandlers, SpeechErrorCode } from './speech-recognition-types';

type Recognition = any;

function ctor(): (new () => Recognition) | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

let current: Recognition | null = null;
/** Marks the current recognition as cancelled, so nothing it heard is used. */
let cancelCurrent: (() => void) | null = null;

export function recognitionSupported(): boolean {
  return !!ctor();
}

function mapError(code: string): SpeechErrorCode {
  switch (code) {
    case 'no-speech': return 'no-speech';
    case 'not-allowed':
    case 'service-not-allowed': return 'not-allowed';
    case 'network': return 'network';
    case 'aborted': return 'aborted';
    default: return 'unknown';
  }
}

export function listen(lang: string, h: ListenHandlers): void {
  const C = ctor();
  if (!C) {
    h.onError('unsupported', 'Speech recognition is not available in this browser');
    return;
  }
  stopListening();

  const r = new C();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;

  let finalText = '';
  let failed = false;
  let cancelled = false;

  r.onresult = (e: any) => {
    if (cancelled) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const t = res[0]?.transcript ?? '';
      if (res.isFinal) finalText += t;
      else interim += t;
    }
    h.onInterim?.((finalText + interim).trim());
  };

  r.onerror = (e: any) => {
    if (cancelled) return;
    const code = mapError(e?.error ?? '');
    if (code === 'aborted') return; // we stopped it ourselves
    failed = true;
    h.onError(code, e?.message || e?.error || 'unknown');
  };

  r.onend = () => {
    if (current === r) {
      current = null;
      cancelCurrent = null;
    }
    // Cancelled: the screen has already gone back to ready, and a new
    // question may be listening by now — so nothing from this one is used.
    if (cancelled) return;
    const text = finalText.trim();
    if (!failed && text) h.onFinal(text);
    h.onEnd?.();
  };

  current = r;
  cancelCurrent = () => { cancelled = true; };
  try {
    r.start();
  } catch (err) {
    current = null;
    cancelCurrent = null;
    h.onError('unknown', String(err));
  }
}

export function stopListening(): void {
  const r = current;
  if (!r) return;
  current = null;
  cancelCurrent = null;
  try {
    // stop() lets a final result through; abort() (cancelListening)
    // discards it. This one is for leaving the screen or turning voice off.
    r.stop();
  } catch {
    // already stopped
  }
}

/**
 * Stops listening and throws away what was heard: nothing is asked. For a
 * person who said something they did not mean to — the mic shows Cancel
 * while it listens.
 */
export function cancelListening(): void {
  const r = current;
  if (!r) return;
  cancelCurrent?.();
  current = null;
  cancelCurrent = null;
  try {
    r.abort();
  } catch {
    // already stopped
  }
}
