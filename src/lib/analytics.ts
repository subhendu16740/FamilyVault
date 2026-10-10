// ─── Usage counts: which screens and buttons people use (PostHog) ───
//
// What it sends is the events named in EVENTS below, each with its own short
// list of properties, and nothing else: a new property means changing this
// file. Never a document, a file name, a question, an answer, a person's
// name, an email or a family's name; a category only from the built-in list
// (categoryForAnalytics()), a screen only as its route ("/document/[id]",
// never an id).
//
// Straight to PostHog's capture API, with no SDK: no automatic capture of
// clicks or text, no screen recording, no cookies. A random id for this
// device, never the account's. No location is looked up ($geoip_disable),
// and the PostHog project is set to discard the internet address.
//
// On in production builds only (the Supabase URL says which, environment.ts)
// and off on a device where the person turned it off (Settings › Privacy).
// DEV, previews and the phone app's test builds send nothing.
// ────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import { appVersion } from './app-info';
import { isProduction } from './environment';
import { deviceKey, storageGet, storageRemove, storageSet } from './storage';

/** What each event may carry. Nothing outside this list is sent. */
export interface AnalyticsEvents {
  screen_viewed: { screen: string };
  document_added: { category: string; file_type: string; vault: 'personal' | 'family' };
  question_asked: { voice: boolean; scope: 'all' | 'one' };
  chat_saved: Record<string, never>;
  share_link_made: { days: number };
  member_invited: Record<string, never>;
  family_created: Record<string, never>;
  plus_viewed: { feature: string };
  pay_started: { period: 'monthly' | 'yearly'; currency: 'INR' | 'USD' };
  payment_done: { period: 'monthly' | 'yearly'; currency: 'INR' | 'USD' };
  emergency_card_saved: Record<string, never>;
  person_added: Record<string, never>;
}

// AskLocker's PostHog project, on EU Cloud. A project API key is public by
// design — it can only send events, and it ships in every page that uses it,
// like Supabase's anon key — so it lives here. EXPO_PUBLIC_POSTHOG_KEY, when
// set, wins (another project, or a test build that should send).
const ASKLOCKER_POSTHOG_KEY = 'phc_wUjEvMCJSmt4JaXwPudmg7WGcyQBpVt8Uwh9C7rTmUB7';

const unquote = (v: string | undefined) => (v ?? '').trim().replace(/^["']|["']$/g, '').trim();
const KEY = unquote(process.env.EXPO_PUBLIC_POSTHOG_KEY) || (isProduction ? ASKLOCKER_POSTHOG_KEY : '');
const HOST = (unquote(process.env.EXPO_PUBLIC_POSTHOG_HOST) || 'https://eu.i.posthog.com').replace(/\/+$/, '');

/** Whether this build sends anything at all (a key was set when it was built). */
export const analyticsBuilt = KEY.length > 0;

type Queued = { event: string; properties: Record<string, unknown>; timestamp: string };

let deviceId: string | null = null;
let off: boolean | null = analyticsBuilt ? null : true;   // null: not read from the device yet
let plan: 'free' | 'plus' | null = null;
let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let ready: Promise<void> | null = null;

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Reads the switch and this device's id once. */
function load(): Promise<void> {
  ready ??= (async () => {
    try {
      off = (await storageGet(deviceKey.analyticsOff)) === '1';
      deviceId = await storageGet(deviceKey.analyticsId);
      if (!deviceId) {
        deviceId = randomId();
        await storageSet(deviceKey.analyticsId, deviceId);
      }
    } catch {
      off = true;   // A device that cannot keep the switch sends nothing.
    }
  })();
  return ready;
}

async function flush(keepalive = false) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length) return;
  await load();
  const batch = queue;
  queue = [];
  if (off || !deviceId) return;
  const id = deviceId;
  try {
    await fetch(`${HOST}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        batch: batch.map((e) => ({ ...e, distinct_id: id, properties: { ...e.properties, distinct_id: id } })),
      }),
      keepalive,
    });
  } catch {
    // Counts are not worth a retry, or an error on anyone's screen.
  }
}

if (analyticsBuilt && Platform.OS === 'web' && typeof document !== 'undefined') {
  // A closing or reloading tab still sends what it has (keepalive outlives
  // the page). Safari may skip visibilitychange on the way out; pagehide it
  // keeps. The second finds the queue empty.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => { flush(true); });
}

/** Counts one event. Does nothing where analytics is off. */
export function track<E extends keyof AnalyticsEvents>(event: E, properties: AnalyticsEvents[E]) {
  if (off === true) return;
  queue.push({
    event,
    timestamp: new Date().toISOString(),
    properties: {
      ...properties,
      plan,
      platform: Platform.OS,
      app_version: appVersion,
      $lib: 'asklocker-app',
      $process_person_profile: false,   // anonymous events: no profile of anyone
      $geoip_disable: true,              // no location from the internet address
    },
  });
  if (queue.length >= 20) flush();
  else timer ??= setTimeout(() => { flush(); }, 10_000);
}

/** Free or Plus, sent with each event, so features can be compared by plan. */
export function setAnalyticsPlan(p: 'free' | 'plus' | null) {
  plan = p;
}

/** The Settings › Privacy switch: on unless turned off on this device. */
export async function analyticsOn(): Promise<boolean> {
  await load();
  return analyticsBuilt && !off;
}

export async function setAnalyticsOn(on: boolean) {
  await load();
  off = !on;
  if (on) {
    await storageRemove(deviceKey.analyticsOff).catch(() => undefined);
  } else {
    queue = [];
    await storageSet(deviceKey.analyticsOff, '1').catch(() => undefined);
  }
}

// Built-in categories as the database seeds them; anything else (a family's
// own category, whose name could say something private) is "Other".
const SYSTEM_CATEGORIES = new Set([
  'Passport', 'National ID / Aadhaar', 'PAN Card', 'Driving License', 'Voter ID', 'Birth Certificate',
  'Marriage Certificate', 'Death Certificate', 'Health Insurance', 'Life Insurance', 'Vehicle Insurance',
  'Property Documents', 'Tax Returns', 'Bank Statements', 'Medical Records', 'Prescriptions',
  'Educational Certificates', 'Employment Letters', 'Legal Documents', 'Utility Bills', 'Visa / Travel Docs',
  'Warranty Cards', 'Other',
]);

/** A category's name only when it is one of the built-in ones. */
export function categoryForAnalytics(category: { name: string; is_system?: boolean | null } | null | undefined): string {
  if (!category) return 'None';
  return category.is_system !== false && SYSTEM_CATEGORIES.has(category.name) ? category.name : 'Other';
}

/** A screen as its route: "/document/[id]", groups like "(tabs)" left out. */
export function screenName(segments: readonly string[]): string {
  const parts = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  return `/${parts.join('/')}`;
}
