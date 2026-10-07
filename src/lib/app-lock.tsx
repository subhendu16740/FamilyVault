// The fingerprint or face lock. After signing in with Google, AskLocker can
// ask for this device's fingerprint or face (or its PIN) when it opens, and
// when it comes back after LOCK_AFTER_MS out of sight. It is per device and
// per account, off until turned on in Settings › Security, and only where
// the device can check a person (app-lock-device.web.ts; the phone app's
// stand-in says no until EAS builds exist).
//
// Google stays the way in. The lock screen's "Use Google instead" signs
// out, and a fresh Google sign-in counts as unlocked for that visit, so a
// lost key never shuts anyone out and the lock is never easier to get past
// than signing in with Google. The lock stays on for next time. The screen
// itself is app-lock-screen.tsx.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './auth';
import { accountKey, storageGet, storageRemove, storageSet } from './storage';
import { createLockKey, forgetLockKey, lockSupported, takeFreshSignIn, unlockWithKey } from './app-lock-device';

/** How long AskLocker may be out of sight before it locks again. */
export const LOCK_AFTER_MS = 5 * 60 * 1000;

/** "5 minutes", for the screens that explain the lock. */
export const lockAfterText = `${LOCK_AFTER_MS / 60_000} minutes`;

interface LockKey {
  /** The device's key, as it named it (base64url). */
  id: string;
  /** When the lock was turned on. */
  at: string;
}

interface AppLockState {
  /** This device can check a fingerprint or face here; null until known. */
  supported: boolean | null;
  /** This account has the lock on, on this device. */
  enabled: boolean;
  /** The lock screen is up. */
  locked: boolean;
  /** Opening AskLocker signed in: deciding whether to lock, with the screen covered meanwhile. */
  deciding: boolean;
  /** Asks the device to make the key; throws, in words a person can read, when it does not. */
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
  /** Asks the device to check the person; throws when it does not. */
  unlock: () => Promise<void>;
}

const AppLockContext = createContext<AppLockState>({
  supported: null,
  enabled: false,
  locked: false,
  deciding: false,
  turnOn: async () => {},
  turnOff: async () => {},
  unlock: async () => {},
});

async function readKey(userId: string): Promise<LockKey | null> {
  const raw = await storageGet(accountKey.appLock(userId));
  if (!raw) return null;
  try {
    const key = JSON.parse(raw);
    return typeof key?.id === 'string' && key.id ? key : null;
  } catch {
    return null;
  }
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const [supported, setSupported] = useState<boolean | null>(null);
  const [key, setKey] = useState<LockKey | null>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  // The first account seen after start-up is AskLocker being opened; any
  // account after that has just signed in.
  const opening = useRef(true);
  const awaySince = useRef<number | null>(null);

  useEffect(() => {
    lockSupported().then(setSupported, () => setSupported(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      setKey(null);
      setKeyFor(null);
      setLocked(false);
      if (opening.current) {
        opening.current = false;
        takeFreshSignIn();   // a sign-in that never came back
      }
      return;
    }
    let cancelled = false;
    readKey(userId).then((found) => {
      if (cancelled) return;
      // Opening AskLocker already signed in locks it; coming back from
      // signing in with Google does not, and nor does signing in here.
      const fresh = takeFreshSignIn();
      if (opening.current) setLocked(!!found && !fresh);
      else setLocked(false);
      opening.current = false;
      setKey(found);
      setKeyFor(userId);
    });
    return () => { cancelled = true; };
  }, [loading, userId]);

  // Out of sight long enough, and it locks again.
  useEffect(() => {
    if (!key) return;
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
  }, [key]);

  const turnOn = useCallback(async () => {
    if (!user) throw new Error('Sign in first.');
    const id = await createLockKey({ userId: user.id, email: user.email ?? '' });
    const made: LockKey = { id, at: new Date().toISOString() };
    await storageSet(accountKey.appLock(user.id), JSON.stringify(made));
    if ((await readKey(user.id))?.id !== id) {
      forgetLockKey(id);
      throw new Error('This browser could not keep the lock (a private window keeps nothing). It is still off.');
    }
    setKey(made);
    setKeyFor(user.id);
  }, [user]);

  const turnOff = useCallback(async () => {
    if (!userId) return;
    await storageRemove(accountKey.appLock(userId));
    if (key) forgetLockKey(key.id);
    setKey(null);
    setLocked(false);
  }, [userId, key]);

  const unlock = useCallback(async () => {
    if (!key) {
      setLocked(false);
      return;
    }
    await unlockWithKey(key.id);
    setLocked(false);
  }, [key]);

  const deciding = !loading && !!userId && keyFor !== userId && opening.current;

  return (
    <AppLockContext.Provider value={{ supported, enabled: !!key, locked: locked && !!userId, deciding, turnOn, turnOff, unlock }}>
      {children}
    </AppLockContext.Provider>
  );
}

export const useAppLock = () => useContext(AppLockContext);
