// Per-user preferences: the voice assistant toggle and its language.
//
// Source of truth is the user's row in public.users (voice_mode_enabled,
// voice_language — migration 012), so the setting follows the person across
// devices and a relative can switch it on for them. A local cache makes the
// toggle instant on the next launch and keeps it working when the row can't
// be read — including before the migration has been applied.

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';
import { storageGet, storageSet } from './storage';
import { DEFAULT_VOICE_LANGUAGE } from './voice-languages';
import { DEFAULT_OCR_LANGUAGES } from './ocr-languages';

interface Preferences {
  voiceMode: boolean;
  voiceLanguage: string;
  /** Tesseract language codes to read scanned documents with. */
  documentLanguages: string[];
}

interface PreferencesContextType extends Preferences {
  /** false until the local cache has been read, so screens don't flash the default. */
  ready: boolean;
  setVoiceMode: (on: boolean) => void;
  setVoiceLanguage: (code: string) => void;
  setDocumentLanguages: (codes: string[]) => void;
}

const DEFAULTS: Preferences = {
  voiceMode: false,
  voiceLanguage: DEFAULT_VOICE_LANGUAGE,
  documentLanguages: DEFAULT_OCR_LANGUAGES,
};

const PreferencesContext = createContext<PreferencesContextType>({
  ...DEFAULTS,
  ready: false,
  setVoiceMode: () => {},
  setVoiceLanguage: () => {},
  setDocumentLanguages: () => {},
});

const cacheKey = (userId: string) => `fv:prefs:${userId}`;

// database.types.ts predates these columns, so the typed client rejects
// them. Same reason `npm run typecheck` already reports 19 errors in api.ts;
// this keeps the count from growing until the types are regenerated.
const users = () => (supabase.from('users') as any);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [ready, setReady] = useState(false);

  // Load: cache first (instant), then the account row (authoritative).
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setPrefs(DEFAULTS);
      setReady(true);
      return;
    }
    setReady(false);

    (async () => {
      const cached = await storageGet(cacheKey(user.id));
      if (cached && !cancelled) {
        try {
          setPrefs({ ...DEFAULTS, ...JSON.parse(cached) });
        } catch {
          // corrupt cache — ignore
        }
      }
      if (!cancelled) setReady(true);

      // Read the newest shape first, then fall back. A column that a
      // migration has not added yet fails the WHOLE select, so without this
      // an unapplied 014 would also stop the voice settings from syncing.
      let { data, error } = await users()
        .select('voice_mode_enabled, voice_language, document_languages')
        .eq('id', user.id)
        .maybeSingle();
      if (error) {
        ({ data, error } = await users()
          .select('voice_mode_enabled, voice_language')
          .eq('id', user.id)
          .maybeSingle());
      }
      if (cancelled) return;
      if (error) {
        // Most likely migration 012 not applied yet either; the cache stands.
        console.warn('[prefs] could not read account preferences:', error.message);
        return;
      }
      if (data) {
        const fromDb: Preferences = {
          voiceMode: !!data.voice_mode_enabled,
          voiceLanguage: data.voice_language || DEFAULT_VOICE_LANGUAGE,
          documentLanguages: Array.isArray(data.document_languages) && data.document_languages.length > 0
            ? data.document_languages
            : DEFAULT_OCR_LANGUAGES,
        };
        setPrefs(fromDb);
        storageSet(cacheKey(user.id), JSON.stringify(fromDb));
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  const persist = useCallback((next: Preferences) => {
    setPrefs(next);
    if (!user) return;
    storageSet(cacheKey(user.id), JSON.stringify(next));

    // Same reasoning as the read: write everything, and if a column is
    // missing, write what the schema does have rather than losing the lot.
    (async () => {
      const full = {
        voice_mode_enabled: next.voiceMode,
        voice_language: next.voiceLanguage,
        document_languages: next.documentLanguages,
      };
      let { error } = await users().update(full).eq('id', user.id);
      if (error) {
        const { document_languages: _omitted, ...voiceOnly } = full;
        ({ error } = await users().update(voiceOnly).eq('id', user.id));
      }
      if (error) console.warn('[prefs] could not save to account:', error.message);
    })();
  }, [user?.id]);

  const setVoiceMode = useCallback((on: boolean) => persist({ ...prefs, voiceMode: on }), [prefs, persist]);
  const setVoiceLanguage = useCallback((code: string) => persist({ ...prefs, voiceLanguage: code }), [prefs, persist]);
  const setDocumentLanguages = useCallback(
    (codes: string[]) => persist({ ...prefs, documentLanguages: codes.length > 0 ? codes : DEFAULT_OCR_LANGUAGES }),
    [prefs, persist],
  );

  return (
    <PreferencesContext.Provider value={{ ...prefs, ready, setVoiceMode, setVoiceLanguage, setDocumentLanguages }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export const usePreferences = () => useContext(PreferencesContext);
