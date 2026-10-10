// ─── Razorpay: prices, currencies and signatures (migration 044) ─
//
// Pure, WebCrypto only, so the payments functions and the QA self-test share
// it. Three rules live here:
//
//   • The price is the server's: plusOrderAmount() reads PLUS_PRICE, the
//     same numbers the Plus page shows. A client says which period, never
//     how much.
//   • A payment counts only with Razorpay's signature: the checkout signs
//     "order_id|payment_id" with the key secret, and every webhook signs its
//     raw body with the webhook secret — both HMAC-SHA256, in hex.
//   • Rupees always; dollars only once international payments are switched
//     on in Razorpay and RAZORPAY_CURRENCIES says "INR,USD".
//   • Who pays in which is the server's call too (payerCurrency()): rupees
//     only when the connection comes from India and the device's time zone
//     agrees, so someone abroad cannot pick rupees by changing a setting.
// ────────────────────────────────────────────────────────────────

import { PLUS_PRICE, plusPrices, type PricePeriod } from './plan-text.ts';

export type RazorpayCurrency = 'INR' | 'USD';

export const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;
export const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/;

/** What a period of Family Plus costs, in paise or cents. */
export function plusOrderAmount(period: PricePeriod, currency: RazorpayCurrency): number {
  return PLUS_PRICE[period][currency === 'INR' ? 'inr' : 'usd'] * 100;
}

/** "Family Plus — 1 month", as the checkout and the receipt say it. */
export function plusOrderDescription(period: PricePeriod): string {
  return `Family Plus — 1 ${period === 'yearly' ? 'year' : 'month'}`;
}

/** The currencies this project takes, from RAZORPAY_CURRENCIES; rupees when unset or unreadable. */
export function acceptedCurrencies(setting: string | undefined | null): RazorpayCurrency[] {
  const asked = (setting ?? '').toUpperCase().split(',').map((c) => c.trim());
  const ok = asked.filter((c): c is RazorpayCurrency => c === 'INR' || c === 'USD');
  return ok.length ? [...new Set(ok)] : ['INR'];
}

const INDIA_TIME_ZONE = /^Asia\/(Kolkata|Calcutta)$/;

/**
 * The connection's country, two letters, from Cloudflare's CF-IPCountry
 * header (Supabase's gateway sits behind Cloudflare, which sets it from the
 * caller's internet address and overwrites one a client sends). Null when
 * Cloudflare does not know ("XX") or the header is missing.
 */
export function connectionCountry(header: string | null | undefined): string | null {
  const c = (header ?? '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9]$/.test(c) && c !== 'XX' ? c : null;
}

/**
 * Rupees or dollars for this payer. Rupees only when the connection is from
 * India and the device's time zone, when the app sends it, is India's; an
 * NRI abroad pays in dollars even with the phone set to India time. With no
 * country, the time zone alone decides, as the app always did. Null when
 * neither is known (an app older than this sends no time zone and chose for
 * itself).
 */
export function payerCurrency(country: string | null, timeZone: unknown): RazorpayCurrency | null {
  const zone = typeof timeZone === 'string' && timeZone.length > 0 && timeZone.length < 64 ? timeZone : null;
  const zoneIndia = zone ? INDIA_TIME_ZONE.test(zone) : null;
  if (country) return country === 'IN' && zoneIndia !== false ? 'INR' : 'USD';
  if (zoneIndia !== null) return zoneIndia ? 'INR' : 'USD';
  return null;
}

/** Said when the app asked to pay in the other currency: what it costs here. */
export function payerCurrencyMessage(currency: RazorpayCurrency): string {
  return currency === 'INR'
    ? `In India, Family Plus is ${plusPrices('inr')}.`
    : `From where you are, Family Plus is ${plusPrices('usd')}.`;
}

const enc = new TextEncoder();

/** HMAC-SHA256 of the message under the secret, in lowercase hex. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The same text, compared without stopping at the first difference. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The checkout's signature on a payment: HMAC-SHA256 of "order_id|payment_id". */
export async function paymentSignatureOk(orderId: string, paymentId: string, signature: string, keySecret: string): Promise<boolean> {
  if (!keySecret || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return sameText(await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`), signature);
}

/** A webhook's signature: HMAC-SHA256 of its raw body, exactly as it arrived. */
export async function webhookSignatureOk(rawBody: string, signature: string, webhookSecret: string): Promise<boolean> {
  if (!webhookSecret || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return sameText(await hmacSha256Hex(webhookSecret, rawBody), signature);
}
