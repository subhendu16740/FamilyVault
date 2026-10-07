// Tiny key-value store for per-device caches (preferences, drafts).
//
// Web uses localStorage; native uses AsyncStorage, required conditionally
// for the same reason as in supabase.ts — importing it unconditionally
// breaks the web build with "window is not defined".
//
// Every call swallows errors: a private window, blocked storage or a
// missing module must never take a screen down. Callers treat a null read
// as "no cached value".

import { Platform } from 'react-native';

let nativeStorage: {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
} | undefined;

if (Platform.OS !== 'web') {
  nativeStorage = require('@react-native-async-storage/async-storage').default;
}

export async function storageGet(key: string): Promise<string | null> {
  try {
    if (nativeStorage) return await nativeStorage.getItem(key);
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(key);
  } catch {
    // fall through
  }
  return null;
}

export async function storageSet(key: string, value: string): Promise<void> {
  try {
    if (nativeStorage) return await nativeStorage.setItem(key, value);
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export async function storageRemove(key: string): Promise<void> {
  try {
    if (nativeStorage) return await nativeStorage.removeItem(key);
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// What this device keeps for one account, keyed by its id so two people on
// one device never read each other's. Every per-account key is named here,
// so deleting an account (forgetAccount) removes all of them — "nothing
// kept" includes the device.
export const accountKey = {
  family: (userId: string) => `fv:family:${userId}`, // the vault last chosen
  prefs: (userId: string) => `fv:prefs:${userId}`,   // voice, languages, notifications
  askIn: (userId: string) => `fv:ask-in:${userId}`,  // where Ask searches: all vaults, or one (046)
  appLock: (userId: string) => `fv:app-lock:${userId}`, // fingerprint sign-in on this device: its passkey at Supabase (app-lock.tsx)
  lockOffer: (userId: string) => `fv:lock-offer:${userId}`, // "Not now" to Home's offer of fingerprint sign-in (lock-offer.tsx)
};

// What this device keeps for every account on it at once.
export const deviceKey = {
  // The accounts with fingerprint sign-in on this device: the login screen
  // offers "Sign in with fingerprint" while there is one (app-lock.tsx).
  passkeysHere: 'fv:passkeys-here',
};

/** The accounts with fingerprint sign-in on this device. */
export async function passkeysHere(): Promise<string[]> {
  try {
    const list = JSON.parse((await storageGet(deviceKey.passkeysHere)) ?? '[]');
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Adds or takes away one account; with none left, the key goes. */
export async function setPasskeyHere(userId: string, here: boolean): Promise<void> {
  const others = (await passkeysHere()).filter((id) => id !== userId);
  const list = here ? [...others, userId] : others;
  if (list.length) await storageSet(deviceKey.passkeysHere, JSON.stringify(list));
  else await storageRemove(deviceKey.passkeysHere);
}

export async function forgetAccount(userId: string): Promise<void> {
  await Promise.all([
    ...Object.values(accountKey).map((key) => storageRemove(key(userId))),
    setPasskeyHere(userId, false),
  ]);
}
