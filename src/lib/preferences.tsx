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

interface Preferences {
  voiceMode: boolean;
  voiceLanguage: string;
}

interface PreferencesContextType extends Preferences {
  /** false until the local cache has been read, so screens don't flash the default. */
  ready: boolean;
  setVoiceMode: (on: boolean) => void;
  setVoiceLanguage: (code: string) => void;
}

const DEFAULTS: Preferences = { voiceMode: false, voiceLanguage: DEFAULT_VOICE_LANGUAGE };

const PreferencesContext = createContext<PreferencesContextType>({
  ...DEFAULTS,
  ready: false,
  setVoiceMode: () => {},
  setVoiceLanguage: () => {},
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

      const { data, error } = await users()
        .select('voice_mode_enabled, voice_language')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Most likely migration 012 not applied yet; the cache stands.
        console.warn('[prefs] could not read account preferences:', error.message);
        return;
      }
      if (data) {
        const fromDb: Preferences = {
          voiceMode: !!data.voice_mode_enabled,
          voiceLanguage: data.voice_language || DEFAULT_VOICE_LANGUAGE,
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
    users()
      .update({ voice_mode_enabled: next.voiceMode, voice_language: next.voiceLanguage })
      .eq('id', user.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn('[prefs] could not save to account:', error.message);
      });
  }, [user?.id]);

  const setVoiceMode = useCallback((on: boolean) => persist({ ...prefs, voiceMode: on }), [prefs, persist]);
  const setVoiceLanguage = useCallback((code: string) => persist({ ...prefs, voiceLanguage: code }), [prefs, persist]);

  return (
    <PreferencesContext.Provider value={{ ...prefs, ready, setVoiceMode, setVoiceLanguage }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export const usePreferences = () => useContext(PreferencesContext);
