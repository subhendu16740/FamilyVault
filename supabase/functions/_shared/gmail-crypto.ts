// ─── Gmail import: the secrets that must never be stored plainly ─
//
// A Gmail refresh token is a standing key to someone's whole mailbox, so it
// is sealed with AES-256-GCM before it touches the database, under a key
// that lives only in the GMAIL_TOKEN_KEY Edge Function secret. A copy of the
// database alone opens nothing.
//
// WebCrypto only, no Deno globals: the QA self-test runs this in Node.
// ────────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Standard base64 or base64url, padded or not. */
export function fromBase64(text: string) {
  const b64 = text.trim().replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Unguessable, URL-safe: states, PKCE verifiers. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256: what Google is shown up front; the verifier proves it later. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The sealing key, from 32 random bytes in base64 (`openssl rand -base64 32`). */
export async function importTokenKey(secret: string): Promise<CryptoKey> {
  let raw = new Uint8Array(0);
  try {
    raw = fromBase64(secret);
  } catch {
    // Not base64 at all: reported just below, with how to make a good one.
  }
  if (raw.length !== 32) {
    throw new Error('GMAIL_TOKEN_KEY must be 32 random bytes in base64 — generate one with: openssl rand -base64 32');
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** "v1.<iv>.<ciphertext>" — the version leaves room to change the scheme. */
export async function sealToken(key: CryptoKey, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  return `v1.${base64url(iv)}.${base64url(sealed)}`;
}

export async function openToken(key: CryptoKey, sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !data) throw new Error('Unrecognised sealed token');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(data));
  return dec.decode(plain);
}
