// Languages offered in Settings › Voice language.
//
// `code` is a BCP-47 tag used for BOTH speech recognition and the voice, and
// sent to rag-search so the answer is written in that language. `native` is
// what the picker shows first — in the language's own script, so a person
// who does not read English can still find theirs.
//
// Whether a given phone can actually recognise or speak a language is
// checked at runtime (see speech.ts hasVoiceFor); this list is the menu,
// not a promise.

export interface VoiceLanguage {
  code: string;
  native: string;
  english: string;
}

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  { code: 'en-IN', native: 'English', english: 'English (India)' },
  { code: 'hi-IN', native: 'हिन्दी', english: 'Hindi' },
  { code: 'bn-IN', native: 'বাংলা', english: 'Bengali' },
  { code: 'ta-IN', native: 'தமிழ்', english: 'Tamil' },
  { code: 'te-IN', native: 'తెలుగు', english: 'Telugu' },
  { code: 'mr-IN', native: 'मराठी', english: 'Marathi' },
  { code: 'gu-IN', native: 'ગુજરાતી', english: 'Gujarati' },
  { code: 'kn-IN', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ml-IN', native: 'മലയാളം', english: 'Malayalam' },
  { code: 'pa-IN', native: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
];

export const DEFAULT_VOICE_LANGUAGE = 'en-IN';

export function voiceLanguage(code: string): VoiceLanguage {
  return VOICE_LANGUAGES.find(l => l.code === code) ?? VOICE_LANGUAGES[0];
}

/** Short spoken/shown phrases the app itself says, per language. Falls back to English. */
const PHRASES: Record<string, Record<string, string>> = {
  en: {
    tap_to_ask: 'Tap the microphone and ask',
    listening: 'Listening…',
    thinking: 'Looking in your documents…',
    ask_another: 'Tap to ask another question',
    not_heard: "I didn't catch that. Tap and try again.",
    mic_denied: 'The microphone is blocked. Allow it in your browser settings.',
    no_voice_support: 'Voice needs Chrome or Safari on this phone.',
    failed: "Sorry, I couldn't process your question. Please try again.",
    read_again: 'Read again',
    stop: 'Stop',
    empty_title: 'Tap the microphone and ask about your documents',
    empty_sub: 'For example: when does my passport expire?',
  },
  hi: {
    tap_to_ask: 'माइक दबाएँ और पूछें',
    listening: 'सुन रहा हूँ…',
    thinking: 'आपके दस्तावेज़ों में देख रहा हूँ…',
    ask_another: 'दूसरा सवाल पूछने के लिए दबाएँ',
    not_heard: 'मैं समझ नहीं पाया। दबाकर फिर से बोलें।',
    mic_denied: 'माइक्रोफ़ोन बंद है। ब्राउज़र की सेटिंग में इसे चालू करें।',
    no_voice_support: 'इस फ़ोन पर आवाज़ के लिए Chrome या Safari चाहिए।',
    failed: 'माफ़ कीजिए, आपका सवाल समझ नहीं आया। फिर से कोशिश करें।',
    read_again: 'फिर से सुनें',
    stop: 'रोकें',
    empty_title: 'माइक दबाएँ और अपने दस्तावेज़ों के बारे में पूछें',
    empty_sub: 'जैसे: मेरा पासपोर्ट कब खत्म हो रहा है?',
  },
};

export function phrase(code: string, key: keyof typeof PHRASES['en']): string {
  const base = code.split('-')[0].toLowerCase();
  return PHRASES[base]?.[key] ?? PHRASES.en[key];
}
