// The fingerprint or face lock's device check, on the web (app-lock.tsx):
// WebAuthn with this device's own authenticator — Android's fingerprint or
// face, Face ID or Touch ID, Windows Hello — with user verification
// required, so the device asks for the finger, the face or its own PIN.
//
// Nothing is sent anywhere. The device checks the person and tells the page
// yes or no; the page keeps only the key's id. So this is a lock on the
// screen: it keeps out someone who picks up an unlocked phone or a computer
// left open, not someone with the browser's developer tools, because the
// sign-in itself is in the browser's storage.

import type { LockSupport } from './app-lock-types';

export type { LockSupport } from './app-lock-types';

const SIGNING_IN = 'fv:signing-in';
/** A redirect sign-in that comes back later than this is not fresh any more. */
const FRESH_MS = 15 * 60 * 1000;

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

function toBase64Url(buffer: ArrayBuffer): string {
  let text = '';
  for (const b of new Uint8Array(buffer)) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const text = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/**
 * The account's id as the key's user handle, so turning the lock off and on
 * again replaces the device's old key instead of piling up new ones.
 */
function userHandle(userId: string): Uint8Array<ArrayBuffer> {
  const hex = userId.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return randomBytes(16);
  return Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
}

function plainError(err: unknown, turningOn: boolean): Error {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError') {
    return new Error(turningOn
      ? 'Not turned on: the fingerprint or face check was cancelled or took too long.'
      : 'Not unlocked: the check was cancelled, took too long or did not match. Try again.');
  }
  if (name === 'InvalidStateError') return new Error('This device already keeps a lock for this account. Try again.');
  if (name === 'NotSupportedError') return new Error('This browser cannot check a fingerprint or face.');
  if (name === 'SecurityError') return new Error('This address cannot use the fingerprint or face check.');
  return new Error((err as Error | null)?.message || 'The fingerprint or face check did not work.');
}

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

/** Asks the device to make this account's lock key; returns its id. */
export async function createLockKey(owner: { userId: string; email: string }): Promise<string> {
  let made: Credential | null;
  try {
    made = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'AskLocker' },
        user: { id: userHandle(owner.userId), name: owner.email || 'AskLocker', displayName: 'AskLocker lock' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
          requireResidentKey: false,
        },
        attestation: 'none',
        timeout: 60_000,
      },
    });
  } catch (err) {
    throw plainError(err, true);
  }
  if (!made || !('rawId' in made)) throw new Error('The device did not make a lock. Try again.');
  return toBase64Url((made as PublicKeyCredential).rawId);
}

/** Resolves once the device has checked the person with the key it made; throws otherwise. */
export async function unlockWithKey(keyId: string): Promise<void> {
  let answer: Credential | null;
  try {
    answer = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: fromBase64Url(keyId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
  } catch (err) {
    throw plainError(err, false);
  }
  const data = (answer as PublicKeyCredential | null)?.response
    ? ((answer as PublicKeyCredential).response as AuthenticatorAssertionResponse).authenticatorData
    : null;
  // Byte 32 of authenticatorData holds the flags; 0x04 says the device
  // verified the person (finger, face or PIN), not just that someone touched it.
  if (!data || data.byteLength < 33 || !(new Uint8Array(data)[32] & 0x04)) {
    throw new Error('Not unlocked: the device did not check a fingerprint, face or PIN.');
  }
}

/** The lock is off: Chrome can drop the key from its password manager too; elsewhere it stays there, unused. */
export function forgetLockKey(keyId: string): void {
  try {
    const PKC = (window as any).PublicKeyCredential;
    const signalled = PKC?.signalUnknownCredential?.({ rpId: window.location.hostname, credentialId: keyId });
    signalled?.catch?.(() => {});
  } catch {
    // Nothing more to do: the key opens nothing without the id this page forgot.
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
