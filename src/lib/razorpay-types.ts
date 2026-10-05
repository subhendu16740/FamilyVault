// What a Razorpay checkout needs and what it ends with (044), shared by the
// web checkout (razorpay.web.ts) and the phone app's stand-in (razorpay.ts).

export interface CheckoutOrder {
  orderId: string;
  /** In paise or cents. */
  amount: number;
  currency: 'INR' | 'USD';
  keyId: string;
  description: string;
  prefill: { email?: string; name?: string };
}

export type CheckoutResult =
  | { status: 'paid'; orderId: string; paymentId: string; signature: string }
  | { status: 'closed' }
  | { status: 'failed'; reason: string }
  | { status: 'unsupported' };
