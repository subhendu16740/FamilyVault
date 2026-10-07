// The phone app signs in with Google through the browser (auth.tsx), as it
// always has. Google's own button is the web's: google-button.web.ts.

import type { GoogleButtonOptions } from './google-button-types';

export type { GoogleButtonOptions } from './google-button-types';

export function googleButtonAvailable(): boolean {
  return false;
}

export async function renderGoogleButton(_container: unknown, _opts: GoogleButtonOptions): Promise<void> {}
