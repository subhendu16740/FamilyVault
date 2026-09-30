// Per-user preferences: the voice assistant toggle and its language, the
// languages scanning reads, and whether notifications are shown.
//
// Source of truth is the user's row in public.users (voice_mode_enabled,
// voice_language — migration 012; document_languages — 014;
// notifications_enabled — 027), so a setting follows the person across
// devices and a relative can switch it on for them. A local cache makes each
// toggle instant on the next launch and keeps it working when the row can't
// be read — including before the migration has been applied.

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';
import { storageGet, storageSet, accountKey } from './storage';
import { DEFAULT_VOICE_LANGUAGE } from './voice-languages';
import { DEFAULT_OCR_LANGUAGES } from './ocr-languages';

interface Preferences {
  voiceMode: boolean;
  voiceLanguage: string;
  /** Tesseract language codes to read scanned documents with. */
  documentLanguages: string[];
  /** Settings › Notifications. Off hides the bell's count and the list;
   *  alerts are still written, so switching back on shows them. */
  notificationsEnabled: boolean;
}

interface PreferencesContextType extends Preferences {
  /** false until the local cache has been read, so screens don't flash the default. */
  ready: boolean;
  setVoiceMode: (on: boolean) => void;
  setVoiceLanguage: (code: string) => void;
  setDocumentLanguages: (codes: string[]) => void;
  setNotificationsEnabled: (on: boolean) => void;
}

const DEFAULTS: Preferences = {
  voiceMode: false,
  voiceLanguage: DEFAULT_VOICE_LANGUAGE,
  documentLanguages: DEFAULT_OCR_LANGUAGES,
  notificationsEnabled: true,
};

const PreferencesContext = createContext<PreferencesContextType>({
  ...DEFAULTS,
  ready: false,
  setVoiceMode: () => {},
  setVoiceLanguage: () => {},
  setDocumentLanguages: () => {},
  setNotificationsEnabled: () => {},
});

const cacheKey = accountKey.prefs;

// Untyped on purpose: the reads and writes below retry with older column
// sets where a migration is not applied, and the generated types only know
// the newest one.
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
      let local: Preferences = DEFAULTS;
      if (cached && !cancelled) {
        try {
          local = { ...DEFAULTS, ...JSON.parse(cached) };
          setPrefs(local);
        } catch {
          // corrupt cache — ignore
        }
      }
      if (!cancelled) setReady(true);

      // Read the newest shape first, then fall back. A column that a
      // migration has not added yet fails the WHOLE select, so without this
      // an unapplied 027 would also stop the voice settings from syncing.
      let data: any = null;
      let error: any = null;
      for (const columns of [
        'voice_mode_enabled, voice_language, document_languages, notifications_enabled',
        'voice_mode_enabled, voice_language, document_languages',
        'voice_mode_enabled, voice_language',
      ]) {
        ({ data, error } = await users().select(columns).eq('id', user.id).maybeSingle());
        if (!error) break;
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
          // Before 027 the column is not there: keep what this device knows
          // rather than resetting it to on.
          notificationsEnabled: typeof data.notifications_enabled === 'boolean'
            ? data.notifications_enabled
            : local.notificationsEnabled,
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
        notifications_enabled: next.notificationsEnabled,
      };
      const { notifications_enabled: _n, ...before027 } = full;
      const { document_languages: _d, ...voiceOnly } = before027;
      let error: any = null;
      for (const row of [full, before027, voiceOnly]) {
        ({ error } = await users().update(row).eq('id', user.id));
        if (!error) break;
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
  const setNotificationsEnabled = useCallback(
    (on: boolean) => persist({ ...prefs, notificationsEnabled: on }),
    [prefs, persist],
  );

  return (
    <PreferencesContext.Provider value={{ ...prefs, ready, setVoiceMode, setVoiceLanguage, setDocumentLanguages, setNotificationsEnabled }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export const usePreferences = () => useContext(PreferencesContext);
