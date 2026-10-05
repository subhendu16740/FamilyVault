// What push.ts (the phone app) and push.web.ts (the web app) both export.

/**
 * Reminders on this device:
 * - `unsupported` — this browser or app cannot show them;
 * - `needs-home-screen` — an iPhone or iPad: only a web app added to the Home Screen may;
 * - `not-ready` — the server is not switched on for them yet (migration 034 or the push function);
 * - `blocked` — the person said no, and only the browser's settings can undo it;
 * - `off` / `on`.
 */
export type PushStatus = 'unsupported' | 'needs-home-screen' | 'not-ready' | 'blocked' | 'off' | 'on';

export type PushResult = { ok: true } | { ok: false; message: string };

export interface TestResult {
  /** This person's devices with reminders on, on any browser. */
  devices: number;
  sent: number;
}
