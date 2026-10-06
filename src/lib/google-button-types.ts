// Google's own sign-in button, shared by the web module (google-button.web.ts)
// and the phone app's stand-in (google-button.ts).

export interface GoogleButtonOptions {
  /** The button's width in pixels; Google draws it between 200 and 400. */
  width: number;
  /** Google signed the person in: its ID token, and the one-time value Supabase checks it against. */
  onToken: (token: string, nonce: string) => void;
  onError: (message: string) => void;
}
