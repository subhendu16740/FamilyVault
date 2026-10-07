// The fingerprint or face lock's device check, shared by the web module
// (app-lock-device.web.ts) and the phone app's stand-in (app-lock-device.ts).

/**
 * Whether this device can check the person here, and if not, why:
 * - `ok`: it can (a fingerprint, a face, or the device's own PIN);
 * - `no-webauthn`: this browser cannot at all — usually a page open inside
 *   another app (WhatsApp, Gmail…) rather than in Chrome or Safari;
 * - `no-device-check`: the browser could, but the device has nothing to
 *   check with — no screen lock, fingerprint, Windows Hello or Touch ID;
 * - `insecure`: not an https address;
 * - `phone-app`: the phone app, until EAS builds exist.
 */
export type LockSupport = 'ok' | 'no-webauthn' | 'no-device-check' | 'insecure' | 'phone-app';
