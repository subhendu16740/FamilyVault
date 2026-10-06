// ─── Web Push: a reminder on a phone or computer, for nothing ───
//
// The browser's own push service — Google's for Chrome and Android, Mozilla's
// for Firefox, Apple's for Safari, Microsoft's for Edge on Windows — carries
// the message to the device, free. Two standards do the work:
//
//   RFC 8291  the message is encrypted to the device's own key (`p256dh`,
//             `auth`): the push service carries it but cannot read it;
//   RFC 8292  VAPID: each request is signed with this server's key, so the
//             push service knows it comes from the server the device
//             subscribed to, and nobody else can push to it.
//
// No library, WebCrypto only and no Deno globals: the QA self-test runs this
// in Node and checks the encryption against RFC 8291's own example, byte for
// byte.
// ────────────────────────────────────────────────────────────────

import { base64url, fromBase64 } from './gmail-crypto.ts';

const enc = new TextEncoder();

/** One browser's subscription, as PushSubscription.toJSON() gives it. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** This server's VAPID identity: an ECDSA P-256 key pair and a contact URL. */
export interface VapidKeys {
  /** The uncompressed public point, base64url: what the browser is given to subscribe. */
  publicKey: string;
  /** The private scalar `d`, base64url. */
  privateKey: string;
  /** A `mailto:` or `https:` URL push services can use to reach whoever runs this server. */
  subject: string;
}

/**
 * Where a subscription may point. A subscription is saved by the app, so its
 * endpoint is whatever a client sent: the server only ever posts to the push
 * services browsers really use, never to an address of someone's choosing.
 * The database checks the same list (migration 034).
 */
const PUSH_HOSTS = /^([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

export function isPushServiceEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The JWK WebCrypto needs for a P-256 key: x and y come from the public point. */
function p256Jwk(publicKey: string, d?: string): JsonWebKey {
  const point = fromBase64(publicKey);
  if (point.length !== 65 || point[0] !== 4) throw new Error('A P-256 public key is 65 bytes, starting 0x04');
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64url(point.subarray(1, 33)),
    y: base64url(point.subarray(33)),
    ...(d ? { d } : {}),
    ext: true,
  };
}

/** A new VAPID key pair, made once per project and kept by the server. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const point = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (!jwk.d) throw new Error('The new VAPID key has no private part');
  return { publicKey: base64url(point), privateKey: jwk.d };
}

/**
 * RFC 8292's Authorization header: a JWT for the push service's origin,
 * signed ES256, good for 12 hours (the RFC allows at most 24).
 */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  expiresAt = Math.floor(Date.now() / 1000) + 12 * 3600,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'jwk', p256Jwk(vapid.publicKey, vapid.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const header = base64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: expiresAt, sub: vapid.subject })));
  // WebCrypto signs ECDSA as r || s, which is exactly what a JWT wants.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${base64url(signature)}, k=${vapid.publicKey}`;
}

// Copies (new Uint8Array) keep WebCrypto's BufferSource types happy whatever array came in.
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(salt), info: new Uint8Array(info) }, key, bytes * 8,
  );
  return new Uint8Array(bits);
}

async function oneOffKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

const RECORD_SIZE = 4096;
/** 4096 octets on the wire, less the 86-octet header, the 16-octet tag and the padding delimiter. */
export const MAX_PLAINTEXT = 3993;

/**
 * RFC 8291 over RFC 8188's aes128gcm, in one record: an 86-octet header
 * (salt, record size, our one-off public key) and the ciphertext.
 * `fixed` exists for RFC 8291's own example — a set salt and server key —
 * and is never used for a real message, where both are fresh each time.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  fixed?: { salt: Uint8Array; publicKey: string; privateKey: string },
) {
  const uaPublic = fromBase64(target.p256dh);
  const authSecret = fromBase64(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("The subscription's p256dh is not a P-256 public key");
  if (authSecret.length !== 16) throw new Error("The subscription's auth secret is not 16 bytes");
  if (plaintext.length > MAX_PLAINTEXT) throw new Error(`A push message carries at most ${MAX_PLAINTEXT} bytes`);

  // Our side of the exchange: one-off for every message.
  const server = fixed
    ? {
      privateKey: await crypto.subtle.importKey(
        'jwk', p256Jwk(fixed.publicKey, fixed.privateKey), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
      ),
      publicKey: fromBase64(fixed.publicKey),
    }
    : await oneOffKey();
  const asPrivate = server.privateKey;
  const asPublic = server.publicKey;
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));
  const keyInfo = concat(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, concat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record, so it is the last: the padding delimiter is 0x02.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, sealed);
}

/** What the service worker shows: public/sw.js reads exactly these fields. */
export interface PushMessage {
  title: string;
  body?: string;
  /** Opened when the notification is tapped; a path within the app. */
  url?: string;
  /** A later message with the same tag replaces this one on the device. */
  tag?: string;
}

export type PushOutcome =
  | { ok: true; status: number }
  /** `gone`: the subscription no longer exists (unsubscribed, expired, site data cleared) — forget it. */
  | { ok: false; status: number; gone: boolean; reason: string };

export async function sendWebPush(
  target: PushTarget,
  message: PushMessage,
  vapid: VapidKeys,
  options: { ttlSeconds?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {},
): Promise<PushOutcome> {
  if (!isPushServiceEndpoint(target.endpoint)) {
    return { ok: false, status: 0, gone: true, reason: 'not a push service address' };
  }
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), target).catch((err: Error) => err);
  // A subscription whose keys cannot be used will never work: forget it.
  if (body instanceof Error) return { ok: false, status: 0, gone: true, reason: body.message };
  let res: Response;
  try {
    res = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(target.endpoint, vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        // How long the push service keeps it for a device that is off: a reminder is still worth seeing tomorrow.
        TTL: String(options.ttlSeconds ?? 2 * 24 * 3600),
        Urgency: options.urgency ?? 'normal',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { ok: false, status: 0, gone: false, reason: (err as Error).message };
  }
  if (res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: true, status: res.status };
  }
  const reason = (await res.text().catch(() => '')).slice(0, 200);
  return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410, reason };
}
