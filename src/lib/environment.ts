// ─── Which backend is this build actually talking to? ───────────
//
// Derived from EXPO_PUBLIC_SUPABASE_URL, deliberately, rather than from a
// separate EXPO_PUBLIC_ENV flag.
//
// A separate flag can be wrong INDEPENDENTLY of the database: set it to
// "prod" on a build pointing at DEV and the app lies about whose documents
// it is showing; forget it on DEV and the warning never appears. The
// Supabase URL is the value that actually decides which family's data is on
// screen, so a marker computed from it cannot disagree with reality.
//
// These are build-time values, compiled into the bundle — so this is fixed
// for the life of a build, and changing it requires a rebuild, not a
// restart.
// ────────────────────────────────────────────────────────────────

/** The one project that holds real family documents. */
const PROD_PROJECT_REF = 'yrcmdixqgvmhqxejvlor';
const DEV_PROJECT_REF = 'tkqsfoppwlyupentuixy';

/**
 * `https://<ref>.supabase.co` → `<ref>`. Empty when it cannot be read.
 *
 * The host must END at supabase.co — matching a bare `.supabase.` prefix
 * would read `<prod ref>.supabase.co.example.com` as production and hide
 * the badge. This value comes from the build's own environment rather than
 * from anyone untrusted, so that is tidiness rather than a vulnerability;
 * but the one case this function exists to get right is deciding that
 * something IS production, so it should be exact.
 */
function projectRefFromUrl(url: string): string {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co(?::\d+)?\/?$/i.exec(url.trim());
  return match ? match[1] : '';
}

export const projectRef = projectRefFromUrl(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');

/**
 * Production is the ONLY case that goes unmarked, and it requires an exact
 * match. Anything else — DEV, a preview, a misconfigured build, no URL at
 * all — is marked.
 *
 * The direction matters: a build that cannot identify itself should shout,
 * not pass silently for production. The failure that costs something is
 * mistaking real family data for test data.
 */
export const isProduction = projectRef === PROD_PROJECT_REF;

export type EnvironmentKind = 'production' | 'development' | 'unknown';

export const environmentKind: EnvironmentKind =
  projectRef === PROD_PROJECT_REF ? 'production'
  : projectRef === DEV_PROJECT_REF ? 'development'
  : 'unknown';

/** Short label for the badge. Production has none — it shows nothing. */
export const environmentLabel: string =
  environmentKind === 'development' ? 'DEV'
  : projectRef ? `UNKNOWN · ${projectRef}`
  : 'NO BACKEND';

/** Longer form, for Settings, where there is room to be explicit. */
export const environmentDescription: string =
  environmentKind === 'production'
    ? 'Production — real family documents'
    : environmentKind === 'development'
      ? 'Development database — test data only'
      : projectRef
        ? `Unrecognised Supabase project (${projectRef})`
        : 'EXPO_PUBLIC_SUPABASE_URL is not set — this build cannot reach a backend';
