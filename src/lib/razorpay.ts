// Paying in the phone app: not yet (044). Razorpay's Android and iOS checkout
// is a native module (react-native-razorpay), which needs an EAS build to
// add and to check. Until then the Plus page says paying is on the web app;
// the web's checkout is razorpay.web.ts.

import type { CheckoutOrder, CheckoutResult } from './razorpay-types';

export type { CheckoutResult, CheckoutOrder } from './razorpay-types';

export const checkoutSupported = false;

export async function openCheckout(_order: CheckoutOrder): Promise<CheckoutResult> {
  return { status: 'unsupported' };
}
