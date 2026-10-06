// Paying on the web: Razorpay's own checkout window (044).
//
// checkout.js is Razorpay's script, loaded the first time someone pays, never
// before. It opens Razorpay's window over the page — UPI, cards, net banking —
// and the card or UPI details go to Razorpay, never to AskLocker. What comes
// back is the order, the payment and Razorpay's signature on the pair, which
// the payments function checks before Family Plus is added.
//
// A payment that fails inside the window lets the person try again there;
// only closing the window ends it, as "closed" or, after a failure, "failed".

import type { CheckoutResult, CheckoutOrder } from './razorpay-types';

export type { CheckoutResult, CheckoutOrder } from './razorpay-types';

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
let loading: Promise<void> | null = null;

function loadCheckout(): Promise<void> {
  if ((window as any).Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = SCRIPT;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => {
      loading = null;
      tag.remove();
      reject(new Error('Razorpay could not be reached. Check the internet connection and try again.'));
    };
    document.head.appendChild(tag);
  });
  return loading;
}

export const checkoutSupported = true;

export async function openCheckout(order: CheckoutOrder): Promise<CheckoutResult> {
  await loadCheckout();
  return new Promise<CheckoutResult>((resolve) => {
    let failure: string | undefined;
    const rzp = new (window as any).Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: 'AskLocker',
      description: order.description,
      prefill: order.prefill,
      theme: { color: '#2A3D66' },
      handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        resolve({ status: 'paid', orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: {
        ondismiss: () => resolve(failure ? { status: 'failed', reason: failure } : { status: 'closed' }),
      },
    });
    rzp.on('payment.failed', (r: { error?: { description?: string } }) => {
      const said = r?.error?.description?.trim() || 'The payment did not go through.';
      failure = /[.!?]$/.test(said) ? said : `${said}.`;
    });
    rzp.open();
  });
}
