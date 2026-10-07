// The phone app's stand-in for the fingerprint or face lock's device check
// (app-lock.tsx). The web app's is app-lock-device.web.ts. The phone app's
// will use expo-local-authentication once EAS builds exist — Face ID cannot
// be tried in Expo Go — so until then the lock is not offered here, and
// Settings › Security does not show it.

export async function lockSupported(): Promise<boolean> {
  return false;
}

export async function createLockKey(_owner: { userId: string; email: string }): Promise<string> {
  throw new Error('The fingerprint or face lock is on the web app for now.');
}

export async function unlockWithKey(_keyId: string): Promise<void> {
  throw new Error('The fingerprint or face lock is on the web app for now. Use Google instead.');
}

export function forgetLockKey(_keyId: string): void {}

export function noteSignInStarted(): void {}

export function takeFreshSignIn(): boolean {
  return false;
}
