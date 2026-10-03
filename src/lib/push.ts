// Reminders on this device — the phone app's stand-in. Notifications on the
// phone app need its own push setup (Expo push, which needs an EAS build),
// which does not exist yet; the web app's are in push.web.ts. Every reminder
// is still under the bell.

import type { PushResult, PushStatus, TestResult } from './push-types';

export type { PushResult, PushStatus, TestResult };

export async function loadPushStatus(): Promise<PushStatus> {
  return 'unsupported';
}

export async function turnOnPush(): Promise<PushResult> {
  return { ok: false, message: 'Notifications in the phone app are coming. For now, turn them on in the web app.' };
}

export async function turnOffPush(): Promise<void> {}

/** On sign-out: this device stops getting the account's notifications. */
export async function forgetPushOnThisDevice(): Promise<void> {}

export async function sendTestPush(): Promise<TestResult> {
  return { devices: 0, sent: 0 };
}
