# FamilyVault — Project Context

A family document vault: upload documents, OCR them, and ask questions in
natural language ("when does Mom's passport expire?") answered by RAG over
the extracted text.

Expo / React Native app (SDK 55) with expo-router. Backend is Supabase
(PostgreSQL + Auth + Storage + Deno Edge Functions).

---

## ⚠️ Read this first

Two things will mislead you if you assume otherwise:

1. **The committed SQL migrations cannot rebuild the database.** They are a
   snapshot from an earlier stage. 11 RPCs the app calls at runtime are not
   defined anywhere in this repo, and the committed `document_chunks` table
   has no `vector` column. See [Database](#database) — do not assume
   `supabase/migrations/` is the source of truth.
2. **This app targets both native and web from one codebase.** Day-to-day
   review happens on the web build (deployed to Vercel), but native
   Android/iOS is a real target with platform-specific code paths. A change
   that works on web can break native. See [Platform splits](#platform-splits).

---

## Commands

```bash
bash scripts/setup.sh          # bootstrap a fresh machine (idempotent)

npm ci                         # install exactly the lockfile
npm run web                    # dev server, web  (expo start --web)
npm start                      # dev server, pick platform interactively
npm run android                # native Android (needs emulator/device)

npm run build                  # static web export -> dist/
npm run typecheck              # tsc --noEmit
```

- **Package manager: npm.** `package-lock.json` is the only lockfile; do not
  introduce yarn/pnpm/bun.
- **Node 22.x** (pinned in `package.json` `engines`). Builds are verified on 22.

### Known-broken commands

| Command | State | Why |
|---|---|---|
| `npm run typecheck` | **Fails — 19 errors, all in `src/lib/api.ts`** | `src/lib/database.types.ts` is stale. It predates the RPCs the app now calls, so every `.rpc()` types as `never`. Fix by regenerating types once the live schema is captured (see [Database](#database)). The 19 errors are pre-existing — don't treat them as caused by your change, but don't add more either. |
| `npm run lint` | **Does not work in a clean clone** | No ESLint config is committed. `expo lint` tries to download one at runtime and fails on any network-restricted machine. There is no working lint gate. |

### Testing

**There is no test framework.** No Jest, no test files, no `test` script.
Verification today means: `npm run typecheck` (error count must not grow past
19), `npm run build` must succeed, and manual checks in the browser.

---

## What merging deploys — and what it doesn't

**Merging to `main` deploys the web bundle and nothing else.** Vercel builds
`src/` into static files. Every server-side change ships by hand, from a
machine with the Supabase CLI. This is the single easiest thing to get wrong:
a merged PR that changes an Edge Function has changed *nothing* in production
until the command below is run.

| Changed | Deployed by | How |
|---|---|---|
| `src/**`, `app.config.ts`, `vercel.json` | **Vercel**, automatically on merge to `main` | nothing to do |
| `supabase/functions/**` | **GitHub Actions**, on merge to `main` | nothing to do (DEV); PROD is a manual `workflow_dispatch` |
| `supabase/migrations/**` | **you** | paste into the SQL editor |
| Edge Function secrets | **you** | `secrets set` |
| Storage buckets | **you** | dashboard only — no CLI, no migration |
| Vercel env vars | **you** | dashboard, then **redeploy** |

### Project refs

| | Supabase project ref |
|---|---|
| DEV — Vercel Preview, and Production while staging | `tkqsfoppwlyupentuixy` |
| PROD | `yrcmdixqgvmhqxejvlor` |

### The commands

Edge Functions deploy themselves via
`.github/workflows/deploy-edge-functions.yml` — merge to `main` ships them to
DEV, and PROD is a manual run of that workflow from the Actions tab. The
commands below are for everything else, or for deploying by hand when the
workflow is unavailable.

No install needed — `npx` fetches the CLI. Log in once per machine.

```bash
npx supabase@latest login

# Deploy an Edge Function (after ANY change under supabase/functions/)
npx supabase@latest functions deploy rag-search       --project-ref <ref>
npx supabase@latest functions deploy ingest-document  --project-ref <ref>
npx supabase@latest functions deploy invite-member    --project-ref <ref>

# Set or rotate a secret (server-side only; never in this repo)
npx supabase@latest secrets set GROQ_API_KEY=...      --project-ref <ref>
npx supabase@latest secrets set HF_API_TOKEN=...      --project-ref <ref>
npx supabase@latest secrets set OCR_SPACE_API_KEY=... --project-ref <ref>

# Capture the live schema (see Database — the migration gap)
npx supabase@latest db dump --db-url "postgresql://..." -f 010_live_schema.sql
```

**Migrations have no CLI path here.** The project is not linked (there is no
`supabase/config.toml`) and migration history was never tracked, so
`db push` is not usable. Apply SQL by pasting the file into the dashboard's
SQL editor — DEV first, then PROD once verified.

`supabase db dump` is **schema-only by default**; there is no `--schema-only`
flag, and it excludes the `storage` schema, so storage RLS policies must be
captured separately.

### Order of operations

1. Migration first, Edge Function second. Write RPC changes so the old
   function still works against the new signature — new parameters last, with
   defaults — and neither order breaks.
2. DEV first, always. Verify in the app, then repeat against PROD.
3. Changing a Vercel env var requires a **redeploy**. `EXPO_PUBLIC_*` values
   are compiled into the bundle at build time; a running deployment cannot
   pick them up.

---

## Environment variables

Copy `.env.example` to `.env`. Every variable is documented there.

**Client — inlined into the JS bundle at BUILD time**, read by
`src/lib/supabase.ts`:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

The `EXPO_PUBLIC_` prefix means *publicly visible in the shipped bundle*.
Never put a secret behind it. The anon key is safe there because Row-Level
Security, not secrecy, is the access boundary. Because they are build-time,
changing one requires a rebuild — there is no runtime config.

**Edge Function secrets** — server-side only, set per Supabase project with
`supabase secrets set NAME=value`, never in this repo:
`GROQ_API_KEY`, `HF_API_TOKEN`, `OCR_SPACE_API_KEY`
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically).

**Local dev only:** `WEB_HOST` (Firebase Studio; see [App config](#app-config)).

---

## Deployment

Web build is hosted on **Vercel** as a static SPA. Config lives in
`vercel.json`; the dashboard needs no build settings beyond env vars.

| | |
|---|---|
| Install | `npm ci` |
| Build | `npx expo export --platform web` |
| Output | `dist` |
| Node | 22.x |

**The SPA rewrite in `vercel.json` is mandatory.** expo-router's web output
defaults to `single`, so the export emits exactly one `index.html` and no
per-route HTML. Without the catch-all rewrite, `/home` and every other deep
link 404s on refresh.

**Environment split — this is what keeps previews away from real data:**

| Vercel environment | Supabase project |
|---|---|
| Production | PROD |
| Preview + Development | DEV |

Set `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` separately
per environment. A PR preview then physically cannot reach production data,
because the bundle was built against a different project URL.

**Edge Functions do not deploy from Vercel.** They ship per Supabase project
via `supabase functions deploy <name>`. A preview pointed at DEV runs DEV's
copies, so DEV needs its own secrets and its own `documents` storage bucket.

**Google OAuth on previews:** `src/lib/auth.tsx` sends
`redirectTo: window.location.origin`, and every preview gets a fresh
subdomain. Supabase → Authentication → URL Configuration must contain a
wildcard redirect URL, or Google sign-in fails on previews while working in
production.

### Native (not yet set up)

There is no `eas.json`, no `expo-updates`, and no EAS project ID. Native
distribution is not wired up. Before a first EAS build:

- `app.config.ts` sets `android.package: "com.anonymous.familyvault"` — the
  `create-expo-app` default. Android package names are permanent once
  published to Play; rename first.
- There is no `ios.bundleIdentifier` at all; an iOS build needs one.

`/ios` and `/android` are gitignored, so the project uses continuous native
generation — which is the layout EAS expects. Nothing needs restructuring.

---

## App config

`app.json` holds the static Expo config. `app.config.ts` is the **dynamic**
config that spreads it (`...config`) and wins when both exist.

**Edit `app.config.ts`, not `app.json`** — fields duplicated in the dynamic
config take precedence, so editing `app.json` alone silently does nothing for
those keys.

`app.config.ts` exists to set `extra.router.origin` from `process.env.WEB_HOST`,
which allows Firebase Studio's proxied preview origin (`https://9000-$WEB_HOST`)
through Expo's dev-server CORS middleware. It is guarded by `if (webHost)`, so
it no-ops anywhere `WEB_HOST` is unset — including Vercel. Harmless to keep.

---

## File layout

```
src/
  app/                       # expo-router: file path = route
    _layout.tsx              # root Stack + AuthGate
    index.tsx                # redirect -> /onboarding or /home
    onboarding.tsx           # 3-slide intro
    login.tsx                # email/password + Google OAuth
    setup-family.tsx         # first-time vault creation
    notifications.tsx        # expiry alerts, uploads, invites
    family.tsx               # family tree + members    (NOT a tab)
    settings.tsx             # profile + sign out       (NOT a tab)
    document/[id].tsx        # document viewer
    +html.tsx                # custom HTML shell, web only
    (tabs)/
      _layout.tsx            # custom tab bar (CustomTabBar)
      home.tsx  search.tsx  upload.tsx
  components/                # shared UI, incl. ProfileDrawer
  constants/theme.ts         # create-expo-app scaffold, largely unused
  hooks/                     # use-color-scheme, use-theme
  lib/                       # see below
  types/                     # ambient .d.ts

supabase/
  functions/                 # Deno Edge Functions (NOT typechecked by tsconfig)
  migrations/                # SQL — incomplete, see Database

scripts/setup.sh             # cloud bootstrap
vercel.json                  # build + SPA rewrite
```

**There are only three tabs** — `home`, `search`, `upload`. `family.tsx` and
`settings.tsx` are top-level routes reached through the ProfileDrawer, *not*
tabs. `(tabs)` is a layout group, so routes are `/home`, `/search`, `/upload`.

### `src/lib/`

| File | Role |
|---|---|
| `supabase.ts` | Client init. AsyncStorage for session persistence on native only. |
| `auth.tsx` | `AuthProvider`: session, signIn, signUp, signInWithGoogle, signOut |
| `family-context.tsx` | `FamilyProvider`: currentFamily, members, membership, needsFamily |
| `drawer-context.tsx` | Profile drawer open/close state |
| `api.ts` | **All** Supabase queries — documents, search, upload, RAG, notifications, invitations |
| `ocr.ts` | Platform-split OCR with progress callback |
| `database.types.ts` | Generated Supabase types — **stale**, see typecheck note |

---

## Platform splits

Metro resolves `*.web.tsx` over `*.tsx` when bundling for web. **Change one,
check the other.** These are the files where web and native genuinely diverge:

```
src/components/animated-icon.tsx   /  animated-icon.web.tsx
src/components/app-tabs.tsx        /  app-tabs.web.tsx
src/hooks/use-color-scheme.ts      /  use-color-scheme.web.ts
src/app/+html.tsx                     (web only — HTML shell, @font-face)
src/global.css                        (web only)
```

Plus 8 `Platform.OS === 'web'` branches across `src/`. The important ones:

- **`src/lib/ocr.ts`** runs two entirely different OCR engines —
  `tesseract.js` (WASM) on web, `react-native-mlkit-ocr` (native module) on
  Android/iOS. Touching this file means reasoning about both.
- **`src/lib/supabase.ts`** only `require`s AsyncStorage on native; importing
  it unconditionally breaks the web build with "window is not defined".

Since review happens on web, native breakage is the drift that goes unnoticed.
Be explicit when a change touches a native-only path.

---

## Database

Supabase, cloud-hosted. Three layers:

- **Layer 1 (common)** — `public` schema: users, families, family_members,
  invitations, document_categories, notifications, audit_logs. RLS enabled.
- **Layer 2 (private)** — one isolated schema per family (`family_<short_uuid>`)
  holding documents, document_metadata, document_chunks, expiry_alerts,
  family_relationships. Created by the `public.create_family()` PG function.
- **Layer 3 (vector)** — pgvector `embedding vector(384)` on `document_chunks`
  with an HNSW index.

File blobs live in a Supabase Storage bucket named `documents`. **The bucket is
not created by any migration** — it was made by hand in the dashboard and must
be created manually in any new project.

### The migration gap

`.gitignore` previously contained `supabase/migrations/*.sql`, so everything
authored after that rule landed was silently never committed. The rule has been
removed, but the missing files were never recovered.

**Not defined in any committed migration, yet called at runtime:**

```
check_expiry_notifications   delete_family_document     get_user_notifications
hybrid_search_documents      insert_family_document     mark_notification_read
update_family_document       complete_document_ingestion
create_expiry_alert          get_document_chunks
```

`rag_retrieve_chunks` was in this list until migration `011` captured it — the
other ten still exist only in the live database.

Also missing: `CREATE EXTENSION vector`, and the committed `document_chunks`
table declares `embedding_id VARCHAR(100)` rather than a `vector(384)` column
with an HNSW index. Layer 3 exists only in the live database.

**Consequences:** a fresh Supabase project cannot be stood up from this repo.
Until the live schema is dumped back into `supabase/migrations/`, treat the
live DB as the only source of truth, and never assume a migration file
reflects production.

To close the gap: `pg_dump --schema-only` against the live project, commit as
`supabase/migrations/010_*.sql`, then regenerate `src/lib/database.types.ts`
(which also fixes `npm run typecheck`).

---

## Edge Functions

`supabase/functions/` — Deno, excluded from `tsconfig.json` (they use remote
`https://` imports and Deno globals that the app's TS config cannot resolve).

- **`ingest-document`** — accepts pre-extracted OCR text from the client, or
  falls back to server-side extraction (simple PDF text parser → OCR.space).
  Chunks (500 tokens, 50 overlap, paragraph-aware) → embeds via HuggingFace
  `all-MiniLM-L6-v2` → extracts metadata (expiry dates, passport/PAN/Aadhaar/
  policy numbers) → stores via `complete_document_ingestion` → creates expiry
  alerts.
- **`rag-search`** — embeds the query (`_shared/embeddings.ts`, same model as
  ingest) → retrieves chunks via `rag_retrieve_chunks`, which blends semantic
  distance and full-text rank 0.7/0.3 → sends chunks + query to Groq → returns
  answer plus source document references. If embedding fails the RPC falls back
  to keyword-only rather than erroring.
  **The Groq model is pinned in one place** (`GROQ_MODEL`, overridable by a
  secret of the same name). `llama-3.3-70b-versatile` was deprecated on
  2026-06-17; check Groq's deprecation page before assuming the current default
  still exists.
- **`invite-member`** — sends family invitation emails via Supabase Auth.

All three handle CORS preflight explicitly.

### RAG pipeline

```
INGEST  upload → client OCR (Tesseract web / ML Kit native) → upload file + text
        → ingest-document → OCR.space fallback if needed → chunk → embed
        → document_chunks (+vectors) + document_metadata → expiry alerts

SEARCH  question → rag-search → embed query → retrieve chunks
        (0.7 semantic + 0.3 keyword) → Groq → answer + source docs
```

---

## Conventions

- **Styling: React Native `StyleSheet` only.** No NativeWind, no Tailwind.
- **Design tokens are not centralised.** The palette below is hardcoded as
  hex literals across 14 screen files. `src/constants/theme.ts` is the
  untouched `create-expo-app` scaffold (generic `Colors`/`Fonts`/`Spacing`)
  and the FamilyVault screens do **not** read from it — don't assume editing
  it changes anything. Match the surrounding file's literals:
  primary `#2A3D66`, secondary `#4A6491`, accent `#D4807B`,
  background `#F8F9FC`, dark bg `#0D1117`, dark card `#161B22`.
- **Shadows: use `boxShadow`, never `shadow*`.** RN 0.84 / SDK 55 deprecate
  `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` on web and warn
  loudly. Keep `elevation` for Android.
  Example: `boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)'`.
- **Icons:** `@expo/vector-icons`, Feather set. Feather has no fingerprint
  glyph — biometric UI uses `"aperture"`.
- Screens use `SafeAreaView` with `edges={['top']}`.
- Use `as any` on `router.push`/`replace` for routes typed routes don't cover
  (e.g. `router.replace('/home' as any)`).
- Re-fetch on focus with `useFocusEffect`, not `useEffect` — plain `useEffect`
  leaves lists stale after a delete on another screen.

---

## Environment notes

Historically developed in **Firebase Studio** (`.idx/dev.nix`: Node 20, JDK 21,
Gradle; web preview on port 9002 proxied through 9000; Android via
`adb -s emulator-5554`). That config is retained but is not required — the
project builds on any machine with Node 22 and npm.

`react-native-devtools` fails to install in the Nix sandbox
(`libglib-2.0.so.0` missing). Harmless; does not affect the web preview or app
functionality.
