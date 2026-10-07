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

/** A value as typed into a dashboard, without the quotes people paste around it. */
function unquote(value: string): string {
  return value.trim().replace(/^['"]+|['"]+$/g, '').trim();
}

/**
 * Every address in the setting, however it was typed: commas, spaces, `;` or
 * new lines between them, quotes around them, with or without `https://`
 * (`http://` for localhost) or a path. Each becomes an origin, as Google
 * compares them: `https://asklocker.com`.
 */
export function parseOrigins(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map(unquote)
    .filter(Boolean)
    .map((o) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(o) ? o : `${/^(localhost|127\.0\.0\.1)(:|$)/i.test(o) ? 'http' : 'https'}://${o}`))
    .map((o) => { try { return new URL(o).origin.toLowerCase(); } catch { return ''; } })
    .filter((o) => !!o && o !== 'null');
}

const CLIENT_ID = unquote(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '');
const ORIGINS = parseOrigins(process.env.EXPO_PUBLIC_GOOGLE_WEB_ORIGINS ?? '');

export function googleButtonAvailable(): boolean {
  if (!CLIENT_ID || typeof window === 'undefined') return false;
  return ORIGINS.includes(window.location.origin.toLowerCase());
}

/**
 * Which sign-in this page uses, and why — for the browser's console, so a
 * setting that did not reach the build, or an address missing from it, can
 * be seen on the live site without a debugger.
 */
export function googleButtonReason(): string {
  if (typeof window === 'undefined') return 'the redirect sign-in: no browser window';
  const here = window.location.origin.toLowerCase();
  if (!CLIENT_ID) return 'the redirect sign-in: this build has no EXPO_PUBLIC_GOOGLE_CLIENT_ID (set it in Vercel for this environment, then redeploy)';
  if (!ORIGINS.includes(here)) {
    return `the redirect sign-in: ${here} is not in EXPO_PUBLIC_GOOGLE_WEB_ORIGINS (this build has: ${ORIGINS.join(', ') || 'nothing'})`;
  }
  return `Google's own button, for ${here} (client …${CLIENT_ID.split('.')[0].slice(-6)})`;
}

let loading: Promise<void> | null = null;

/** How long Google's script may take before the login falls back to the redirect sign-in. */
const SCRIPT_WAIT_MS = 10_000;

function loadScript(): Promise<void> {
  if ((window as any).google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script');
    const fail = (message: string) => {
      clearTimeout(timer);
      loading = null;
      tag.remove();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('Google took too long to answer.'), SCRIPT_WAIT_MS);
    tag.src = SCRIPT;
    tag.async = true;
    tag.onload = () => {
      clearTimeout(timer);
      if ((window as any).google?.accounts?.id) resolve();
      else fail('Google\'s sign-in script loaded without its sign-in.');
    };
    tag.onerror = () => fail('Google could not be reached. Check the internet connection and try again.');
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
