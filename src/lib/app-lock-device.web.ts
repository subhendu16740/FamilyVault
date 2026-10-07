// What fingerprint sign-in (app-lock.tsx) needs from the browser itself.
// The passkey ceremonies are Supabase's (registerPasskey, signInWithPasskey);
// this file says whether this device can take part — WebAuthn with its own
// authenticator: Android's fingerprint or face, Face ID or Touch ID, Windows
// Hello, or the device's PIN — and marks a redirect sign-in that is on its
// way back, so the page it returns to does not lock.

import type { LockSupport } from './app-lock-types';

export type { LockSupport } from './app-lock-types';

const SIGNING_IN = 'fv:signing-in';
/** A redirect sign-in that comes back later than this is not fresh any more. */
const FRESH_MS = 15 * 60 * 1000;

/** Whether this device can check a fingerprint, a face or its PIN for this page, and if not, why. */
export async function lockSupport(): Promise<LockSupport> {
  if (typeof window === 'undefined') return 'no-webauthn';
  if (!window.isSecureContext) return 'insecure';
  const PKC = (window as any).PublicKeyCredential;
  if (!PKC || typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable !== 'function' || !navigator.credentials) {
    return 'no-webauthn';
  }
  try {
    return (await PKC.isUserVerifyingPlatformAuthenticatorAvailable()) ? 'ok' : 'no-device-check';
  } catch {
    return 'no-device-check';
  }
}

/**
 * A key the lock's first version made on this device (before passkeys), now
 * of no use: Chrome can drop it from its password manager; elsewhere it stays
 * there, opening nothing.
 */
export function forgetLockKey(keyId: string): void {
  try {
    const PKC = (window as any).PublicKeyCredential;
    const signalled = PKC?.signalUnknownCredential?.({ rpId: window.location.hostname, credentialId: keyId });
    signalled?.catch?.(() => {});
  } catch {
    // Nothing more to do.
  }
}

/**
 * Before the redirect sign-in leaves for Google: the page that comes back
 * signed in is a fresh sign-in, not AskLocker being opened, so it does not
 * lock. Kept for this tab only.
 */
export function noteSignInStarted(): void {
  try {
    window.sessionStorage.setItem(SIGNING_IN, String(Date.now()));
  } catch {
    // Without it, the page that comes back simply locks: safe, one tap more.
  }
}

/** Whether this page load is the return from a sign-in; asking forgets it. */
export function takeFreshSignIn(): boolean {
  try {
    const started = Number(window.sessionStorage.getItem(SIGNING_IN));
    window.sessionStorage.removeItem(SIGNING_IN);
    return started > 0 && Date.now() - started < FRESH_MS;
  } catch {
    return false;
  }
}
