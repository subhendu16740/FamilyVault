// Google's own "Sign in with Google" button, on the web (Google Identity
// Services).
//
// The redirect sign-in (supabase.auth.signInWithOAuth) sends a person through
// Supabase's address and back, and Google's screen names that address:
// "to continue to <project>.supabase.co". Setting an app name in Google Cloud
// does not change it — Google shows a name only once it has verified the
// brand, which takes owning every address in the flow, and nobody owns
// supabase.co. With Google's own button nothing passes through Supabase's
// address: Google hands this page an ID token, and Supabase checks it
// (signInWithIdToken). So Google names this app's own address instead — or
// "AskLocker", once the brand is verified.
//
// Only where it is set up, because Google refuses an address it was not told
// about: EXPO_PUBLIC_GOOGLE_CLIENT_ID is the sign-in client (public, like the
// anon key), and EXPO_PUBLIC_GOOGLE_WEB_ORIGINS the addresses added to that
// client's Authorized JavaScript origins. Anywhere else — a preview with a
// fresh address, or before the setting is made — the redirect sign-in, as
// before.

import type { GoogleButtonOptions } from './google-button-types';

export type { GoogleButtonOptions } from './google-button-types';

const SCRIPT = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
const ORIGINS = (process.env.EXPO_PUBLIC_GOOGLE_WEB_ORIGINS ?? '')
  .split(',')
  .map((o: string) => o.trim().replace(/\/+$/, '').toLowerCase())
  .filter(Boolean);

export function googleButtonAvailable(): boolean {
  if (!CLIENT_ID || typeof window === 'undefined') return false;
  return ORIGINS.includes(window.location.origin.toLowerCase());
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if ((window as any).google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = SCRIPT;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => {
      loading = null;
      tag.remove();
      reject(new Error('Google could not be reached. Check the internet connection and try again.'));
    };
    document.head.appendChild(tag);
  });
  return loading;
}

/**
 * A fresh one-time value for this sign-in. Google puts its SHA-256 (in hex)
 * into the ID token; Supabase hashes the raw value and checks the two match,
 * so a token cannot be replayed.
 */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hashed };
}

/** Draws Google's button into `container`. Call it again for a fresh one-time value. */
export async function renderGoogleButton(container: HTMLElement, opts: GoogleButtonOptions): Promise<void> {
  await loadScript();
  const { raw, hashed } = await makeNonce();
  const google = (window as any).google;
  google.accounts.id.initialize({
    client_id: CLIENT_ID,
    nonce: hashed,
    callback: (response: { credential?: string }) => {
      if (response?.credential) opts.onToken(response.credential, raw);
      else opts.onError('Google did not sign you in. Please try again.');
    },
    ux_mode: 'popup',
    auto_select: false,
    itp_support: true,
  });
  container.innerHTML = '';
  google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'rectangular',
    logo_alignment: 'center',
    width: Math.max(200, Math.min(400, Math.round(opts.width))),
  });
}
