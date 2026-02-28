import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Platform } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

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
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signInWithGoogle: async () => ({ error: null }),
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

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    return { error: error?.message ?? null };
  };

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

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
