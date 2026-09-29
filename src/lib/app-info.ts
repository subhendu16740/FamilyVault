// What Settings › About and Help & FAQ show about the app itself.
//
// The version comes from app.config.ts; the release date and commit are
// stamped there when the bundle is built (see `extra`), so for a web deploy
// the date is the day that deploy was made.

import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { releaseDate?: string; commit?: string };

export const appVersion: string = Constants.expoConfig?.version ?? '1.0.0';

export const releaseDate: Date | null = (() => {
  const d = extra.releaseDate ? new Date(extra.releaseDate) : null;
  return d && !isNaN(d.getTime()) ? d : null;
})();

/** Short commit hash of the build, when the build knew it (Vercel does). */
export const buildCommit: string = extra.commit ?? '';

// Help & FAQ › Contact us. Empty until there is a support address and number
// to publish; the section shows only what is filled in, and Send feedback is
// always there.
export const SUPPORT_EMAIL = '';
export const SUPPORT_PHONE = '';
