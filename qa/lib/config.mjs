// ─── Configuration, and the guard that keeps QA off PROD ─────────
//
// QA uploads and deletes documents, signs in as its own accounts and spends
// the free Groq budget. None of that may ever happen against production, so
// the URL is checked here, once, before any client exists.
//
// The one thing QA does read from PROD is two catalog queries through the
// Management API (checks/db.mjs): the 023 sweep and the 024 fingerprint,
// exactly what CLAUDE.md says to run by hand on both projects. They read
// function definitions and grants, never rows of anyone's data.
// ────────────────────────────────────────────────────────────────

export const DEV_REF = 'tkqsfoppwlyupentuixy';
export const PROD_REF = 'yrcmdixqgvmhqxejvlor';

export const SUITES = ['smoke', 'nightly', 'full', 'no-questions'];
export const AREAS = ['db', 'access', 'upload', 'ask'];

export function parseArgs(argv) {
  const args = { suite: 'smoke', plan: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const value = () => inline ?? argv[++i];
    if (flag === '--suite') args.suite = value();
    else if (flag === '--only') args.only = value().split(',').map((s) => s.trim());
    else if (flag === '--plan') args.plan = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!SUITES.includes(args.suite)) throw new Error(`--suite must be one of: ${SUITES.join(', ')}`);
  for (const area of args.only ?? []) {
    if (!AREAS.includes(area)) throw new Error(`--only takes: ${AREAS.join(', ')}`);
  }
  return args;
}

export function loadConfig(env = process.env) {
  const url = (env.QA_SUPABASE_URL || `https://${DEV_REF}.supabase.co`).replace(/\/+$/, '');
  if (url.includes(PROD_REF)) {
    throw new Error(
      `QA refuses to run against PROD (${PROD_REF}): it uploads and deletes documents and spends the ` +
        'free Groq budget. Point QA_SUPABASE_URL at DEV.',
    );
  }
  const need = (name) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  return {
    url,
    anonKey: need('QA_SUPABASE_ANON_KEY'),
    a: { email: need('QA_A_EMAIL'), password: need('QA_A_PASSWORD') },
    b: { email: need('QA_B_EMAIL'), password: need('QA_B_PASSWORD') },
    managementToken: env.SUPABASE_ACCESS_TOKEN || '',
    spacingSeconds: Number(env.QA_SPACING_SECONDS || 90),
    runId: env.GITHUB_RUN_ID || `local-${Date.now().toString(36)}`,
    commit: (env.GITHUB_SHA || '').slice(0, 7),
  };
}

/** The run's date: QA_DATE overrides it, for trying a rotation locally. */
export function runDate(env = process.env) {
  return env.QA_DATE ? new Date(`${env.QA_DATE}T12:00:00Z`) : new Date();
}
