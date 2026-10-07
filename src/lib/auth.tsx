import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Platform } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { forgetPushOnThisDevice } from './push';

// Only import and run browser/auth-session APIs on client side (avoid SSR crashes)
let WebBrowser: typeof import('expo-web-browser') | null = null;
let redirectUri = '';

if (typeof window !== 'undefined') {
  WebBrowser = require('expo-web-browser');
  WebBrowser!.maybeCompleteAuthSession();
  const { makeRedirectUri } = require('expo-auth-session');
  redirectUri = makeRedirectUri();
}

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** Google is the only way in, and the first sign-in makes the account. This is the redirect sign-in. */
  signInWithGoogle: () => Promise<{ error: string | null }>;
  /**
   * Test builds only (DEV and previews, where isProduction is false): QA's
   * accounts and testing with several accounts. The login screen shows the
   * form nowhere else; production signs in with Google only.
   */
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  /** Test builds only, like signInWithPassword. `signedIn` is false while the address waits to be confirmed. */
  signUpWithPassword: (email: string, password: string, displayName: string) => Promise<{ error: string | null; signedIn: boolean }>;
  /** Google's own button on the web (google-button.web.ts): the ID token it gave, and the one-time value it carries. */
  signInWithGoogleToken: (token: string, nonce: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
  signInWithGoogle: async () => ({ error: null }),
  signInWithPassword: async () => ({ error: null }),
  signUpWithPassword: async () => ({ error: null, signedIn: false }),
  signInWithGoogleToken: async () => ({ error: null }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      if (Platform.OS === 'web') {
        // On web: use redirect-based OAuth (page navigates to Google, then back)
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: typeof window !== 'undefined' ? window.location.origin : '',
          },
        });
        if (error) return { error: error.message };
        // Page will redirect — no further action needed
        return { error: null };
      }

      // On native: use WebBrowser popup flow
      if (!WebBrowser) return { error: 'Google sign-in is not available in this environment' };

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
        },
      });

      if (error) return { error: error.message };
      if (!data.url) return { error: 'No OAuth URL returned' };

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

      if (result.type === 'success') {
        const url = new URL(result.url);
        const params = new URLSearchParams(
          url.hash ? url.hash.substring(1) : url.search.substring(1)
        );
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) return { error: sessionError.message };
        }
      }

      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Google sign-in failed' };
    }
  };

  const signInWithPassword = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUpWithPassword = async (email: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    return { error: error?.message ?? null, signedIn: !!data?.session };
  };

  // Supabase checks Google's signature, that the token is for this app's
  // client, and that it carries this nonce's hash — then signs the person in,
  // making the account the first time, as the redirect sign-in does.
  const signInWithGoogleToken = async (token: string, nonce: string) => {
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token, nonce });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    // Before the session goes: this device stops getting the account's notifications (034).
    await forgetPushOnThisDevice();
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signInWithGoogle,
        signInWithPassword,
        signUpWithPassword,
        signInWithGoogleToken,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
