// Reminders on this device, in the web app: Web Push through the browser's
// own push service (free), shown by public/sw.js. The server side is
// migration 034 and the `push` Edge Function; push.ts is the phone app's
// stand-in.
//
// Chrome, Edge, Firefox and Safari on a computer, and Chrome on Android, can
// all show them. An iPhone or iPad can only once AskLocker is added to the
// Home Screen (iOS 16.4 or later) and opened from there.

import { supabase } from './supabase';
import { isMissingMigration } from './api';
import type { PushResult, PushStatus, TestResult } from './push-types';

export type { PushResult, PushStatus, TestResult };

const WORKER = '/sw.js';

const HOME_SCREEN =
  'On iPhone or iPad, tap Share, then Add to Home Screen. Open AskLocker from there and turn reminders on.';
const UNSUPPORTED = "This browser can't show notifications. Try Chrome, Edge, Firefox or Safari.";
const BLOCKED =
  'Notifications are blocked. Allow them for this site in your browser settings, then try again.';
const NOT_READY = "Reminders on devices aren't available yet.";

let serverKeyCache: string | null = null;

function canPush(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** An iPhone or iPad outside a Home Screen web app: the one place push needs that step first. */
function appleNeedsHomeScreen(): boolean {
  if (typeof window === 'undefined') return false;
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return apple && !installed;
}

function keyBytes(key: string) {
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function sameKey(current: ArrayBuffer | null, key: string): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(key);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** "Chrome on Android": how the device is named in the list of where reminders go. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'A browser';
  const system = /Android/.test(ua) ? 'Android'
    : /iPhone|iPod/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'a Chromebook'
    : /Mac OS X|Macintosh/.test(ua) ? 'a Mac'
    : /Linux/.test(ua) ? 'Linux'
    : 'a computer';
  return `${browser} on ${system}`;
}

/** The server's public key, or 'not-ready' where the push function or migration 034 is missing. */
async function serverKey(): Promise<string | 'not-ready'> {
  if (serverKeyCache) return serverKeyCache;
  const { data, error } = await supabase.functions.invoke('push', { body: { action: 'key' } });
  if (error) {
    const status = (error as { context?: Response })?.context?.status;
    if (status === 404 || status === 503) return 'not-ready';
    throw new Error("Couldn't reach AskLocker. Try again.");
  }
  if (typeof data?.public_key !== 'string') throw new Error("Couldn't reach AskLocker. Try again.");
  serverKeyCache = data.public_key;
  return data.public_key;
}

async function thisBrowsersSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function loadPushStatus(): Promise<PushStatus> {
  if (!canPush()) return appleNeedsHomeScreen() ? 'needs-home-screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    if ((await serverKey()) === 'not-ready') return 'not-ready';
  } catch {
    return 'off';   // unreachable just now; turning on says so
  }
  const subscription = await thisBrowsersSubscription().catch(() => null);
  if (!subscription || Notification.permission !== 'granted') return 'off';
  // On for this account? Someone else may have turned it on in this browser.
  const { data, error } = await supabase.from('push_subscriptions').select('id').eq('endpoint', subscription.endpoint).maybeSingle();
  return !error && data ? 'on' : 'off';
}

export async function turnOnPush(): Promise<PushResult> {
  if (!canPush()) return { ok: false, message: appleNeedsHomeScreen() ? HOME_SCREEN : UNSUPPORTED };
  // First, while the tap still counts: browsers ask only in answer to one.
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return { ok: false, message: BLOCKED };
  if (permission !== 'granted') {
    return { ok: false, message: 'To get reminders, allow notifications when your browser asks.' };
  }

  const key = await serverKey();
  if (key === 'not-ready') return { ok: false, message: NOT_READY };

  await navigator.serviceWorker.register(WORKER);
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // Made with another key (the server's were made again): start afresh.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });

  const { endpoint, keys } = subscription.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: endpoint ?? '',
    p_p256dh: keys?.p256dh ?? '',
    p_auth: keys?.auth ?? '',
    p_label: deviceLabel(),
  });
  if (error) {
    if (isMissingMigration(error)) return { ok: false, message: NOT_READY };
    if (error.code === '23514') {
      return { ok: false, message: "AskLocker can't send notifications to this browser. Try Chrome, Edge, Firefox or Safari." };
    }
    throw new Error(error.message);
  }
  return { ok: true };
}

export async function turnOffPush(): Promise<void> {
  if (!canPush()) return;
  const subscription = await thisBrowsersSubscription();
  if (!subscription) return;
  // The row first, while signed in; then the browser forgets it. Even if the
  // row stays, the next push meets a gone device and the server forgets it.
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe().catch(() => false);
  if (error && !isMissingMigration(error)) throw new Error(error.message);
}

/** On sign-out: this browser stops getting the account's notifications. Never stops the sign-out. */
export async function forgetPushOnThisDevice(): Promise<void> {
  try {
    await turnOffPush();
  } catch {
    // Signing out goes ahead regardless.
  }
}

export async function sendTestPush(): Promise<TestResult> {
  const { data, error } = await supabase.functions.invoke('push', { body: { action: 'test' } });
  if (error) throw new Error("Couldn't send a test. Try again.");
  return { devices: data?.devices ?? 0, sent: data?.sent ?? 0 };
}
