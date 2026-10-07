// Fingerprint sign-in: once it is on, a fingerprint or face — or the
// device's own PIN — signs a person in to AskLocker, with no Google and no
// password, and opens it when it is locked. It is a passkey kept by Supabase
// Auth (registerPasskey / signInWithPasskey): the device holds the private
// half and checks the person; Supabase holds the public half and checks the
// device's signature before it gives out a session. Nothing about a finger or
// a face leaves the device.
//
// Per device and per account, off until turned on (Settings › Security, or
// Home's offer). Once on:
// - the login screen offers "Sign in with fingerprint" on this device
//   (deviceKey.passkeysHere lists who turned it on here);
// - AskLocker locks when it is opened already signed in, and when it comes
//   back after LOCK_AFTER_MS out of sight; the fingerprint opens it again.
// Google stays a way in: the lock screen's "Use Google instead" signs out,
// and any fresh sign-in opens AskLocker without the lock for that visit.
//
// The project must have passkeys switched on (Supabase › Authentication ›
// Passkeys, with this address among its origins); where it has not, turning
// it on says so. The device's part is app-lock-device(.web).ts; the lock
// screen, app-lock-screen.tsx.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from './auth';
import { supabase } from './supabase';
import { accountKey, passkeysHere, setPasskeyHere, storageGet, storageRemove, storageSet } from './storage';
import { forgetLockKey, lockSupport, takeFreshSignIn } from './app-lock-device';
import type { LockSupport } from './app-lock-types';

/** How long AskLocker may be out of sight before it locks again. */
export const LOCK_AFTER_MS = 5 * 60 * 1000;

/** "5 minutes", for the screens that explain the lock. */
export const lockAfterText = `${LOCK_AFTER_MS / 60_000} minutes`;

/**
 * Why fingerprint sign-in is not offered here, in words a person can act on —
 * shown in Settings › Security instead of the switch, so it is never simply
 * missing without a reason.
 */
export function lockUnavailableText(support: LockSupport): string {
  switch (support) {
    case 'no-webauthn':
      return 'This browser cannot check a fingerprint or face. Open AskLocker in Chrome, Safari or Edge itself — not inside another app such as WhatsApp or Gmail — and look here again.';
    case 'no-device-check':
      return 'This phone or computer has nothing the browser can check you with: no screen lock, fingerprint or face. On a phone, set a screen lock and add your fingerprint in the phone\'s settings; on a computer, set up Windows Hello or Touch ID. Then look here again.';
    case 'insecure':
      return 'Fingerprint sign-in works only on a secure (https) address.';
    case 'phone-app':
      return 'Fingerprint sign-in is on the web app for now; the phone app gets it with its first release.';
    default:
      return '';
  }
}

type PasskeyStep = 'on' | 'signin' | 'unlock' | 'off';

/** A Supabase or browser passkey error, in words a person can read. */
export function passkeyErrorText(error: unknown, step: PasskeyStep): string {
  const e = error as { code?: string; name?: string; message?: string; status?: number; cause?: { name?: string } } | null;
  const code = e?.code ?? '';
  const domName = e?.cause?.name ?? e?.name ?? '';
  const notOn = 'Fingerprint sign-in is not switched on for AskLocker yet.';
  if (code === 'passkey_disabled') return notOn;
  if (code === 'webauthn_credential_not_found') {
    return 'This fingerprint sign-in was turned off. Sign in with Google, then turn it on again in Settings › Security.';
  }
  if (code === 'too_many_passkeys') {
    return 'Your account has all the fingerprint sign-ins it can have. Turn it off on a phone or computer you no longer use, then try again.';
  }
  if (code === 'webauthn_challenge_expired' || code === 'webauthn_challenge_not_found') {
    return 'That took too long. Please try again.';
  }
  if (code === 'ERROR_CEREMONY_ABORTED') {
    return 'That was stopped. Please try again.';
  }
  if (code === 'webauthn_verification_failed') {
    return 'The fingerprint check could not be confirmed. Please try again.';
  }
  if (code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID' || domName === 'SecurityError') {
    return `Fingerprint sign-in is not set up for this address (${typeof window !== 'undefined' ? window.location.host : 'here'}).`;
  }
  // A sign-in service with no passkeys at all: no such address.
  if (e?.status === 404 || /page not found|not valid JSON/i.test(e?.message ?? '')) return notOn;
  if (e?.name === 'AuthRetryableFetchError' || /fetch|network/i.test(e?.message ?? '')) {
    return 'AskLocker could not be reached. Check the internet connection and try again.';
  }
  if (/does not support WebAuthn/i.test(e?.message ?? '')) {
    return 'This browser cannot use fingerprint sign-in.';
  }
  if (domName === 'NotAllowedError' || code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY') {
    if (step === 'on') return 'Not turned on: the fingerprint or face check was cancelled or took too long.';
    if (step === 'signin') return 'Not signed in: the check was cancelled, or this device has no fingerprint sign-in for AskLocker. Sign in with Google below.';
    return 'Not unlocked: the check was cancelled or took too long. Please try again.';
  }
  return e?.message || 'That did not work. Please try again.';
}

let supportTold = false;

interface LockEntry {
  /**
   * The passkey this device made, as Supabase names it: what turning it off
   * here deletes. Null when the device already held one of the account's
   * passkeys — synced from another phone or computer by Google Password
   * Manager or iCloud Keychain — which turning it off here leaves to that
   * device.
   */
  passkeyId: string | null;
  /** When it was turned on. */
  at: string;
}

interface AppLockState {
  /** This device can check a fingerprint or face here; null until known. */
  supported: boolean | null;
  /** And if not, why (lockUnavailableText); null until known. */
  support: LockSupport | null;
  /** This account has fingerprint sign-in on, on this device. */
  enabled: boolean;
  /** Someone has fingerprint sign-in on this device: the login screen offers it. */
  availableHere: boolean;
  /** The lock screen is up. */
  locked: boolean;
  /** Opening AskLocker signed in: deciding whether to lock, with the screen covered meanwhile. */
  deciding: boolean;
  /** Makes this account's passkey; throws, in words a person can read, when it does not. */
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
  /** The lock screen's check: a passkey sign-in. Throws when it does not succeed. */
  unlock: () => Promise<void>;
  /** The login screen's button: a passkey sign-in, no Google. Throws when it does not succeed. */
  signIn: () => Promise<void>;
}

const AppLockContext = createContext<AppLockState>({
  supported: null,
  support: null,
  enabled: false,
  availableHere: false,
  locked: false,
  deciding: false,
  turnOn: async () => {},
  turnOff: async () => {},
  unlock: async () => {},
  signIn: async () => {},
});

/**
 * This account's entry on this device. The lock's first version kept a key
 * of its own here ({ id }, before passkeys); such an entry opens nothing now,
 * so it is dropped, and its key let go.
 */
async function readEntry(userId: string): Promise<LockEntry | null> {
  const raw = await storageGet(accountKey.appLock(userId));
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw);
    if ((typeof entry?.passkeyId === 'string' && entry.passkeyId) || entry?.passkeyId === null) return entry;
    if (typeof entry?.id === 'string') forgetLockKey(entry.id);
  } catch {
    // unreadable: dropped below
  }
  await storageRemove(accountKey.appLock(userId));
  return null;
}

/** A passkey sign-in, Supabase's ceremony end to end; throws its error in plain words. */
async function passkeySignIn(step: 'signin' | 'unlock'): Promise<void> {
  const { data, error } = await supabase.auth.signInWithPasskey();
  if (!error && data?.session) return;
  if (step === 'signin' && (error?.code === 'webauthn_credential_not_found' || error?.code === 'passkey_disabled')) {
    // The passkey offered is gone (turned off elsewhere, or its account
    // deleted), or the project's passkeys are off: the login screen stops
    // offering fingerprint sign-in. Whose it was is not known here, so it
    // stops for everyone on this device; an account whose passkey still works
    // gets it back the next time it signs in (entryStillWorks).
    for (const id of await passkeysHere()) await setPasskeyHere(id, false);
  }
  throw new Error(error ? passkeyErrorText(error, step) : 'Not signed in. Please try again.');
}

/**
 * Whether this account's fingerprint sign-in still works: its passkey still
 * there (not turned off on another device that shares it) and the project's
 * passkeys still on. Null when that cannot be told — offline, say — which
 * leaves everything as it is.
 */
async function entryStillWorks(entry: LockEntry): Promise<boolean | null> {
  const { data, error } = await supabase.auth.passkey.list();
  if (error) return error.code === 'passkey_disabled' ? false : null;
  if (!Array.isArray(data)) return null;
  return entry.passkeyId ? data.some((p) => p.id === entry.passkeyId) : data.length > 0;
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const [support, setSupport] = useState<LockSupport | null>(null);
  const [entry, setEntry] = useState<LockEntry | null>(null);
  const [entryFor, setEntryFor] = useState<string | null>(null);
  const [availableHere, setAvailableHere] = useState(false);
  const [locked, setLocked] = useState(false);
  // The first account seen after start-up is AskLocker being opened; any
  // account after that has just signed in.
  const opening = useRef(true);
  const awaySince = useRef<number | null>(null);
  const checked = useRef<LockEntry | null>(null);
  const currentUser = useRef(userId);
  currentUser.current = userId;

  const refreshHere = useCallback(async () => {
    setAvailableHere((await passkeysHere()).length > 0);
  }, []);

  useEffect(() => {
    lockSupport().then(setSupport, () => setSupport('no-device-check'));
    refreshHere();
  }, [refreshHere]);

  // Says in the browser's console whether this device can use it, and why
  // not — once a page load, like the Google sign-in's line.
  useEffect(() => {
    if (!support || supportTold || Platform.OS !== 'web') return;
    supportTold = true;
    console.info('[Fingerprint sign-in]', support === 'ok'
      ? 'this device can check a fingerprint, face or PIN: Settings › Security can turn it on'
      : `not offered here (${support}): ${lockUnavailableText(support)}`);
  }, [support]);

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      setEntry(null);
      setEntryFor(null);
      setLocked(false);
      refreshHere();
      if (opening.current) {
        opening.current = false;
        takeFreshSignIn();   // a sign-in that never came back
      }
      return;
    }
    let cancelled = false;
    readEntry(userId).then((found) => {
      if (cancelled) return;
      // Opening AskLocker already signed in locks it; coming back from a
      // sign-in does not, and nor does signing in here.
      const fresh = takeFreshSignIn();
      if (opening.current) setLocked(!!found && !fresh);
      else setLocked(false);
      opening.current = false;
      setEntry(found);
      setEntryFor(userId);
    });
    return () => { cancelled = true; };
  }, [loading, userId, refreshHere]);

  // Fingerprint sign-in turned off on another device that shares the passkey,
  // or passkeys switched off for the project: off here too, and unlocked —
  // nothing could open it — so Google is not the only way past a lock that
  // can never open. Checked once for each entry read, and each time it locks;
  // a check that cannot be made keeps the lock. Still working, and the login
  // screen offers it again if a failed sign-in had stopped it.
  useEffect(() => {
    if (!entry || !userId) return;
    if (!locked && checked.current === entry) return;
    checked.current = entry;
    entryStillWorks(entry).then(async (works) => {
      if (works === null || currentUser.current !== userId) return;
      if (works) {
        await setPasskeyHere(userId, true);
      } else {
        // Unless it was turned on again meanwhile.
        if ((await readEntry(userId))?.at !== entry.at) return;
        await storageRemove(accountKey.appLock(userId));
        await setPasskeyHere(userId, false);
        if (currentUser.current !== userId) return;
        setEntry((now) => (now?.at === entry.at ? null : now));
        setLocked(false);
      }
      await refreshHere();
    });
  }, [entry, userId, locked, refreshHere]);

  // Out of sight long enough, and it locks again.
  useEffect(() => {
    if (!entry) return;
    awaySince.current = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        awaySince.current ??= Date.now();
        return;
      }
      if (awaySince.current !== null && Date.now() - awaySince.current >= LOCK_AFTER_MS) setLocked(true);
      awaySince.current = null;
    });
    return () => sub.remove();
  }, [entry]);

  const turnOn = useCallback(async () => {
    if (!user) throw new Error('Sign in first.');
    const { data, error } = await supabase.auth.registerPasskey();
    // The device already holds one of the account's passkeys — synced from
    // another phone or computer, or made here before this browser forgot it —
    // and can sign in with that one, so none is made.
    const shared = error?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || error?.code === 'webauthn_credential_exists';
    if (!data?.id && !shared) throw new Error(passkeyErrorText(error, 'on'));
    const passkeyId = data?.id ?? null;
    const made: LockEntry = { passkeyId, at: new Date().toISOString() };
    await storageSet(accountKey.appLock(user.id), JSON.stringify(made));
    const kept = await readEntry(user.id);
    if (!kept || kept.passkeyId !== passkeyId) {
      if (passkeyId) await supabase.auth.passkey.delete({ passkeyId });
      throw new Error('This browser could not keep fingerprint sign-in (a private window keeps nothing). It is still off.');
    }
    await setPasskeyHere(user.id, true);
    setEntry(made);
    setEntryFor(user.id);
    await refreshHere();
  }, [user, refreshHere]);

  const turnOff = useCallback(async () => {
    if (!userId) return;
    if (entry?.passkeyId) {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: entry.passkeyId });
      // Gone already (turned off on another device, say) is as good as deleted.
      if (error && error.status !== 404 && error.code !== 'webauthn_credential_not_found') {
        throw new Error(passkeyErrorText(error, 'off'));
      }
    }
    await storageRemove(accountKey.appLock(userId));
    await setPasskeyHere(userId, false);
    setEntry(null);
    setLocked(false);
    await refreshHere();
  }, [userId, entry, refreshHere]);

  const unlock = useCallback(async () => {
    if (!entry) {
      setLocked(false);
      return;
    }
    await passkeySignIn('unlock');
    setLocked(false);
  }, [entry]);

  const signIn = useCallback(async () => {
    try {
      await passkeySignIn('signin');
    } finally {
      await refreshHere();
    }
  }, [refreshHere]);

  const deciding = !loading && !!userId && entryFor !== userId && opening.current;

  return (
    <AppLockContext.Provider
      value={{
        supported: support === null ? null : support === 'ok',
        support,
        enabled: !!entry,
        availableHere: availableHere && support === 'ok',
        locked: locked && !!userId,
        deciding,
        turnOn,
        turnOff,
        unlock,
        signIn,
      }}
    >
      {children}
    </AppLockContext.Provider>
  );
}

export const useAppLock = () => useContext(AppLockContext);
