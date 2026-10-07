// The phone app's stand-in for what fingerprint sign-in (app-lock.tsx) needs
// from the device. The web app's is app-lock-device.web.ts. The phone app's
// needs Supabase's two-step passkey API with a native passkey library, and
// expo-local-authentication for the lock, once EAS builds exist — Face ID
// cannot be tried in Expo Go — so until then it is not offered here, and
// Settings › Security does not show it.

import type { LockSupport } from './app-lock-types';

export type { LockSupport } from './app-lock-types';

export async function lockSupport(): Promise<LockSupport> {
  return 'phone-app';
}

export function forgetLockKey(_keyId: string): void {}

export function noteSignInStarted(): void {}

export function takeFreshSignIn(): boolean {
  return false;
}
