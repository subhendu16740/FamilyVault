# FamilyVault — Project Context

A family document vault: upload documents, OCR them, and ask questions in
natural language ("when does Mom's passport expire?") answered by RAG over
the extracted text.

Expo / React Native app (SDK 55) with expo-router. Backend is Supabase
(PostgreSQL + Auth + Storage + Deno Edge Functions).

---

## ⚠️ Read this first

Four things will mislead you if you assume otherwise:

1. **The schema-taking RPCs are service-role ONLY, and that is load-bearing.**
   The `rag_*` functions and `get_document_chunks` take the family's schema
   as a *parameter* and check no membership, so reachability IS the access
   control. Migration 022 revokes the original twelve from `anon` and
   `authenticated`, and each one added since (031's `rag_documents_for_people`)
   carries the same revoke; before
   it, any signed-in account could read or destroy any family's documents by
   naming their schema. Never grant one of these to a client role, and never
   add a new schema-taking function without the same revoke.
2. **A user id passed as an argument is not an identity.** A `SECURITY DEFINER`
   function runs with the owner's rights, so RLS never applies inside it. If
   a client role can execute it, it must take the caller from `auth.uid()` —
   or open with `perform public.assert_caller_is(p_user_id)` /
   `assert_caller_in_family(p_family_id)` (migration 023) — never from a
   parameter. Before 023, thirteen functions broke this rule, and `anon` with
   no login could rename, delete or add any family's documents and read
   anyone's notifications. Functions only the server calls get
   `REVOKE ... FROM PUBLIC, anon, authenticated` and a grant to
   `service_role`, nothing more. The sweep at the bottom of 023 must return
   zero rows on both projects; run it after any change to a function. It
   lives in `qa/sql/sweep.sql`, and the QA workflow runs it on every run.
3. **Clients write only the columns the app writes, and add no members.**
   Supabase grants `anon` and `authenticated` every column of every table,
   and RLS checks rows, not columns — so `users_update_own` let any account
   set its own `is_superuser` (and then read every family's member list and
   every profile), and a family admin could rewrite `storage_namespace`.
   Migration 025 revokes table-wide INSERT and UPDATE on `users`, `families`,
   `family_members`, `notifications` and `invitations` and grants back only
   the columns the app changes (listed in 025's header; 027 adds your own
   `display_name`, `phone` and `notifications_enabled`, and a write-only
   `feedback` table; 028 adds `saved_chats`, which only its owner reads;
   029's account-deletion functions are service role only; 031's family
   tree is read by members and written only through its four functions;
   032's emergency cards likewise, through `save_emergency_card`; 034's
   notification devices are their owner's, written only through
   `save_push_subscription`; 035 adds your own `birthday_reminders`; 036's
   share links are read by the family, never their secret's hash, and made
   or turned off only through `create_document_share` and
   `revoke_document_share`; 037's invitations are read by the family, by
   the address asked, and answered or withdrawn only through their
   functions; 038's plan limits are read by anyone and a family's plan by
   its members, never its payment reference, and set only through
   `set_family_plan`, service role only).
   **A new writable
   column needs its own `GRANT` in a migration.** Nobody joins a family
   without saying yes: only an admin asks a person in, through the
   `add-member` Edge Function (or asks someone already in the family tree to
   be that person, through `link-account`, 033), the person joins only by
   accepting (037), and clients cannot insert a membership row at all. See
   [Membership](#membership--an-admin-invites-only-a-yes-joins-025-037).
4. **This app targets both native and web from one codebase.** Day-to-day
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
| `npm run typecheck` | **Passes — 0 errors** | It failed with 19 errors for most of the project's life, all from a stale `src/lib/database.types.ts` in which every `.rpc()` typed as `never`. Regenerating it fixed all 19 at once. **Keep it at 0.** After any migration, regenerate the file — and re-append the hand-written block at the bottom, which the generator does not produce. |
| `npm run lint` | **Does not work in a clean clone** | No ESLint config is committed. `expo lint` tries to download one at runtime and fails on any network-restricted machine. There is no working lint gate. |

### Testing

The app itself has no unit tests: `npm run typecheck` (**must stay at 0
errors**) and `npm run build` are the local gates.

**`qa/` is an end-to-end suite against the DEV project**, run by
`.github/workflows/qa.yml` — after every Edge Function deploy to DEV, nightly
at 03:10 IST, and on pushes that change `qa/`. It uploads synthetic SPECIMEN
documents to its own vault (QA Vault A, account A), asks questions about
them, and checks the answers on facts and sources, never wording. It also
runs the 023 sweep and the 024 DEV/PROD fingerprint, 122 access probes (a
logged-out visitor and a second account must be refused everywhere, Gmail
import's endpoints, the family tree, emergency cards, linking,
notification devices, share links, invitations and plans included; a share
link must open without an account, and stop once it is turned off; nobody
can give a family Plus, raise a limit or read another family's storage),
the membership model (the second account is invited, not added: it sees
nothing of the vault until it says yes, the admin cannot say yes for it, a
no removes the invitation and a yes makes it a viewer, who must not be able
to escalate or share an admin's document, becomes a person in the family
tree, writes only its own emergency card, must be able to leave, and is
linked to an entry in the tree both ways: merged at once while a member,
invited back as it after leaving),
a question asked by relation ("my mother's passport"), and the full upload → ingest →
expiry-notification pipeline, the reminder made once however often Home asks. By hand only, suite `languages` asks 12
questions about documents in eight more Indian languages — two of them
photos OCR'd the way the web app does it, with Tesseract — which is about
43% of the free Groq day on its own. See `qa/README.md`.

- **It spends the free Groq budget carefully, by design.** Each question is
  ~9K tokens, mostly on the relevance judge (`gpt-oss-20b`: 8K tokens/min,
  200K/day). Questions go one at a time, 90s apart; the run backs off on a
  rate limit and stops if Groq pushes back twice; at most two post-deploy
  runs a day may ask questions. A rate limit is *inconclusive*, never a
  failure. Worst day ≈ half of `gpt-oss-20b`'s free allowance.
- **It never touches PROD data** — the runner refuses a PROD URL. Its only
  PROD access is the two read-only catalog queries above.
- **Everything in `qa/fixtures/` is fictional and says so.** This repo is
  public: never commit a real document there, or anywhere.
- `qa/` has its own `package.json` and lockfile (like `marketing/video`), so
  the app's `npm ci` and the Vercel build never install it.
- **Known issues** (🐞) are real defects the suite already understands: listed
  in every run's summary without turning it red, and they pass by themselves
  once fixed. Currently two open, both about reading Indian scripts, plus
  three fixed in the ingest code that QA reports until DEV runs it — see
  [Known issues found by QA](#known-issues-found-by-qa).

---

## Branches — `dev` is the integration branch, `main` is live

```
feature branch  ──▶  dev   ──▶  main
                      │          │
                      ▼          ▼
                     DEV       PROD
```

Work happens on feature branches and merges to **`dev`**. A release is `dev`
merged to **`main`**. Nothing is committed straight to either.

**The branch decides the backend, and the mechanism differs per layer** —
this is the part that is easy to get silently wrong:

| Layer | How the branch maps to a project |
|---|---|
| Web bundle | Vercel: `main` is the Production branch → PROD env vars; every other branch builds as a Preview → DEV env vars |
| Edge Functions | `.github/workflows/deploy-edge-functions.yml`: push to `main` → PROD, push to `dev` → DEV |
| Migrations | Neither. Always by hand, in the SQL editor |

**`EXPO_PUBLIC_*` values are compiled into the bundle at build time**, so a
build is permanently bound to whichever project it was built against. That is
what makes the Vercel environment split a real boundary rather than a
convention: a preview physically cannot reach PROD data.

**Before `dev` existed, `main` WAS the integration branch and deployed
functions to DEV.** If that mapping is ever restored while `main` is the
release branch, every production release will quietly ship its functions to
DEV and leave PROD on old code. The workflow resolves the target from
`github.ref` for exactly this reason, and anything unrecognised falls to DEV —
the safe direction for a mistake is the test project.

### What merging deploys — and what it doesn't

Every server-side change other than Edge Functions ships by hand. This is the
single easiest thing to get wrong: a merged PR that changes a migration has
changed *nothing* until someone pastes it into the SQL editor.

| Changed | Deployed by | How |
|---|---|---|
| `src/**`, `app.config.ts`, `vercel.json` | **Vercel**, automatically | `main` → PROD, any other branch → DEV |
| `supabase/functions/**` | **GitHub Actions**, automatically | `main` → PROD, `dev` → DEV; `workflow_dispatch` for either by hand |
| `supabase/migrations/**` | **you** | paste into the SQL editor |
| Edge Function secrets | **you** | `secrets set`, per project |
| Storage buckets | **you** | dashboard only — no CLI, no migration |
| Vercel env vars | **you** | dashboard, then **redeploy** |

**Order still matters within a release:** the migration goes first, the Edge
Function second, per [Order of operations](#order-of-operations). Merging to
`main` ships the function immediately, so apply the migration to PROD *before*
you merge, not after.

### Which build am I looking at?

`src/lib/environment.ts` derives this from `EXPO_PUBLIC_SUPABASE_URL` — **not**
from a separate `EXPO_PUBLIC_ENV` flag, deliberately. A separate flag can be
wrong independently of the database; the Supabase URL is the value that
actually decides whose documents are on screen, so a marker computed from it
cannot disagree with reality.

`<EnvBadge />` is mounted once in `src/app/_layout.tsx`, after the `Stack`, so
it draws over every screen and a new screen cannot be added without it. It
hangs from the top edge, in the part of the 56px top bar that no title
reaches — a badge in the middle of the bar hid the screen's title. It
renders **nothing** in production, and production requires an exact match on
the PROD project ref — DEV, a preview, an unrecognised project and a missing
URL all show the badge. The direction is deliberate: a build that cannot
identify itself should shout rather than pass silently for production.
Settings › About carries the longer description.

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
npx supabase@latest functions deploy add-member       --project-ref <ref>
npx supabase@latest functions deploy link-account     --project-ref <ref>
npx supabase@latest functions deploy delete-account   --project-ref <ref>
npx supabase@latest functions deploy push             --project-ref <ref>   # reminders on devices; makes its own keys
npx supabase@latest functions deploy share            --project-ref <ref>   # opens a share link, for anyone who has it
npx supabase@latest functions deploy reembed-index    --project-ref <ref>
npx supabase@latest functions deploy gmail-connect    --project-ref <ref>   # also gmail-scan, gmail-import
npx supabase@latest functions deploy gmail-callback   --project-ref <ref> --no-verify-jwt   # Google's redirect target

# Set or rotate a secret (server-side only; never in this repo)
npx supabase@latest secrets set GROQ_API_KEY=...      --project-ref <ref>
npx supabase@latest secrets set HF_API_TOKEN=...      --project-ref <ref>
npx supabase@latest secrets set OCR_SPACE_API_KEY=... --project-ref <ref>
npx supabase@latest secrets set GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... GMAIL_TOKEN_KEY=... GMAIL_RETURN_ORIGINS=... --project-ref <ref>

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
   **A default is not enough on its own.** PostgREST resolves an RPC by the
   exact argument names it is given: against a database without the migration,
   passing a new argument fails the *whole* call rather than falling back to
   the old overload, and a `select` naming a column that does not exist yet
   fails the whole select. Both turned working features into silent dead ends
   here. So every call that depends on a migration tries the new shape, and on
   a "could not find the function" / "column does not exist" error retries the
   shape that has always existed (`retrieveChunks`, `loadState`, `saveState`,
   `preferences.tsx`). Assume the migration has NOT been applied.
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
`GROQ_API_KEY`, `HF_API_TOKEN`, `OCR_SPACE_API_KEY`, and for Gmail import
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` (the OAuth client of the separate
Google Cloud project made for Gmail), `GMAIL_TOKEN_KEY` (32 random bytes,
base64 — `openssl rand -base64 32`; it seals refresh tokens, so changing it
disconnects everyone) and `GMAIL_RETURN_ORIGINS` (the web origins Google may
return to, comma-separated; localhost is always allowed)
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
    notifications.tsx        # expiry alerts, uploads, invites, Family Plus
    family.tsx               # Manage Family: members, invitations (Pending approval), leaving    (NOT a tab)
    family-tree.tsx          # the family tree: everyone, and how they are related (031)
    person/[id].tsx          # one person: their relation to you, emergency card, documents, expiry dates, link to their account (033)
    emergency/               # emergency cards (032), in the drawer
      index.tsx              # everyone in the tree, blood group at a glance
      [id].tsx               # one card, full screen, every number one tap from the dialler
      edit/[id].tsx          # add or edit a card: an admin, or the person themselves
    reminders.tsx            # expiry dates, soonest first, and how reminders reach you (★ Family Plus, in the drawer)
    saved-chats.tsx          # behind the clock on Ask: chats kept with Save chat (028)
    settings/                # (NOT a tab) its own Stack, so Back returns to Settings
      index.tsx              # the list; every row opens a screen
      profile.tsx  security.tsx  notifications.tsx  privacy.tsx   # notifications: the switch, and this device (034)
      storage.tsx  help.tsx  feedback.tsx  about.tsx   # storage: each family's plan, and how much of its space is used (038)
      delete-account.tsx     # Security › Delete account: shows what goes, asks for DELETE (029)
    document/[id].tsx        # document viewer; Share opens the share sheet (036, web only)
    gmail-import.tsx         # connect Gmail, review what it found, import (web only, ★ Family Plus)
    s.tsx                    # what a share link opens: one document, for anyone with the link, no account (036)
    +html.tsx                # custom HTML shell, web only
    (tabs)/
      _layout.tsx            # custom tab bar (CustomTabBar)
      home.tsx  search.tsx  upload.tsx
  components/                # shared UI, incl. ProfileDrawer, ShareSheet (036) and InvitationCards (037)
  constants/design.ts        # the one type/size/spacing scale every screen uses
  constants/theme.ts         # create-expo-app scaffold, largely unused
  hooks/                     # use-color-scheme, use-theme
  lib/                       # see below
  types/                     # ambient .d.ts

supabase/
  functions/                 # Deno Edge Functions (NOT typechecked by tsconfig)
  migrations/                # SQL — incomplete, see Database

public/                      # copied to the web build's root: sw.js (shows notifications), manifest, icons
qa/                          # end-to-end QA against DEV (own package.json)
  run.mjs  questions.yaml    # the runner, and what it asks
  fixtures/documents.mjs     # the SPECIMEN documents and the facts they carry
  sql/                       # the 023 sweep and the 024 fingerprint

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
| `api.ts` | **All** Supabase queries — documents, search, upload, RAG, notifications, adding and leaving families, invitations, Gmail import, saved chats, share links, deleting your account, plans and storage limits (`fetchStorageStatus`, `fetchPlanLimits`; `uploadDocument` throws `StorageFullError` before a file that does not fit is sent), and the Settings screens (profile, password, storage use, expiry dates, feedback) |
| `dates.ts` | `parseDocumentDate()`: expiry dates exactly as ingest stores them (DD/MM/YYYY and kin, YYYY-MM-DD, "19 October 2026") |
| `emergency.ts` | The emergency card's shape, blood groups (`bloodGroupLabel()`: "A−", "Bombay (hh)"), `telHref()`, and `cardProblem()` — the same checks and messages as `save_emergency_card()`, so the form can say what is wrong before saving |
| `family-people.ts` | Whose a document can be: everyone in the tree, you first (`useDocumentOwners()`, members only before 031), and a person's expiry badge (`badgeFromExpiries()`) |
| `plans.ts` | What each plan may keep (038): the limits as 038 sets them (`DEFAULT_PLAN_LIMITS`, used only when the database cannot be asked), `storageLevel()`, and the words for a full vault (`storageFullMessage()`), which live in `supabase/functions/_shared/plan-text.ts` so Gmail import says the same. `PLUS_FOR_SALE` is false until payments exist |
| `file-types.ts` | What a picked file is (`detectFileType()`: MIME type, then name, never a web `blob:` uri) and whether the vault can keep it (PDF, JPG, PNG) |
| `app-info.ts` | Version, release date and commit (stamped into `extra` by `app.config.ts` at build time), and the support contact Help shows |
| `ocr.ts` | Platform-split OCR with progress callback; reads the person's chosen languages |
| `ocr-languages.ts` | The document-language picker list, and `resolveOcrLanguages()` which always appends English |
| `push.ts` / `push.web.ts` | Notifications on this device (034): on the web, Web Push through `public/sw.js` (`loadPushStatus`, `turnOnPush`, `turnOffPush`, `sendTestPush`, and `forgetPushOnThisDevice` on sign-out); the phone app's file is a stand-in until EAS builds exist. Types in `push-types.ts` |
| `preferences.tsx` | `PreferencesProvider`: voice toggle + language, document languages. Cached locally, stored on `public.users`; reads and writes fall back to the older column set so an unapplied migration degrades one setting rather than all of them |
| `speech.ts` | Voice: `listen`/`stopListening` (platform-split recogniser) and `speak`/`stopSpeaking` (expo-speech) |
| `speech-text.ts` | `toSpeech()`: strips markdown and spells out ID numbers before they are read aloud |
| `voice-languages.ts` | The language picker list and the few phrases the app itself says, per language |
| `storage.ts` | Key-value cache: localStorage on web, AsyncStorage on native |
| `database.types.ts` | Generated Supabase types, current to 038 (030 changed nothing in them). Regenerate after every migration and re-append the hand-written block at the bottom (see the typecheck note) |

---

## Platform splits

Metro resolves `*.web.tsx` over `*.tsx` when bundling for web. **Change one,
check the other.** These are the files where web and native genuinely diverge:

```
src/components/animated-icon.tsx   /  animated-icon.web.tsx
src/components/app-tabs.tsx        /  app-tabs.web.tsx
src/hooks/use-color-scheme.ts      /  use-color-scheme.web.ts
src/lib/speech-recognition.ts      /  speech-recognition.web.ts
src/lib/push.ts                    /  push.web.ts
src/app/+html.tsx                     (web only — HTML shell, @font-face; NOT used by the single-page export)
public/sw.js                          (web only — the service worker that shows notifications)
src/global.css                        (web only)
```

Plus 8 `Platform.OS === 'web'` branches across `src/`. The important ones:

- **`src/lib/ocr.ts`** runs two entirely different OCR engines —
  `tesseract.js` (WASM) on web, `react-native-mlkit-ocr` (native module) on
  Android/iOS. Touching this file means reasoning about both.
  **Languages diverge here.** Tesseract reads every Indian script, fetching
  each ~10-20MB model from a CDN on first use, so the web build honours the
  person's Settings › Documents choice in full. The bundled ML Kit package
  (`play-services-mlkit-text-recognition`) reads **Latin script only** —
  Devanagari and the rest are separate ML Kit artifacts needing a native
  build — so the upload screen warns via `ocrLanguageGapOnThisDevice()`
  rather than silently returning garbage.
- **Pickers return different uris.** On native a picked file's uri ends in a
  real file name (`…/ImagePicker/abc.jpeg`); on the web it is
  `blob:https://host/<id>`, with no name in it at all. Upload used to take
  the text after the uri's last "." as the file type, so every Gallery and
  Scan photo on the web became `app/<id>`: OCR was skipped, the preview said
  PDF, and the database refused the row (`file_type` is 20 characters) after
  the file was already in Storage. A file's type comes from its MIME type or
  name, through `detectFileType()` in `src/lib/file-types.ts`, never from a
  uri; `uploadDocument` refuses anything the `documents` bucket would, before
  uploading, and removes the stored file if the row is refused.
- **`src/lib/supabase.ts`** only `require`s AsyncStorage on native; importing
  it unconditionally breaks the web build with "window is not defined".
  `src/lib/storage.ts` follows the same pattern.
- **`src/lib/speech-recognition.web.ts`** is the browser's Web Speech API
  (Chrome, Safari; not Firefox). The native twin is a stub that reports
  "unsupported" until the phone's recogniser is wired up with
  `expo-speech-recognition` and microphone permission strings — that needs
  an EAS build to verify. Text-to-speech (`expo-speech`) already works on
  both.

Since review happens on web, native breakage is the drift that goes unnoticed.
Be explicit when a change touches a native-only path.

---

## Database

Supabase, cloud-hosted. Three layers:

- **Layer 1 (common)** — `public` schema: users, families, family_members,
  invitations, document_categories, notifications, audit_logs, feedback,
  saved_chats, family_people, family_links, family_emergency_cards,
  push_subscriptions, reminders_sent, push_config, document_shares,
  family_invites, plan_limits, family_plans. RLS enabled.
- **Layer 2 (private)** — one isolated schema per family (`family_<short_uuid>`)
  holding documents, document_metadata, document_chunks, expiry_alerts,
  family_relationships. Created by the `public.create_family()` PG function.
- **Layer 3 (vector)** — pgvector `embedding vector(384)` on `document_chunks`
  with an HNSW index.

File blobs live in a Supabase Storage bucket named `documents`. **The bucket is
not created by any migration** — it was made by hand in the dashboard and must
be created manually in any new project.

### The migration gap — closed, and checked properly this time

`.gitignore` previously contained `supabase/migrations/*.sql`, so everything
authored after that rule landed was silently never committed. Migrations
`019`–`024` recovered it: **every function in `public` is now in a committed
migration, and DEV and PROD match.**

An earlier version of this section also said the two databases were
"identical". That was checked by comparing function **names and counts** —
not bodies, not columns — and it was wrong. Migration 024 records what the
proper comparison found; the three that mattered:

- **PROD could not create a vault.** `families.is_personal` (and
  `users.emergency_info`) had been added to DEV by hand. `create_family()`
  writes `is_personal`, so on PROD it failed and the first real user would
  have been stuck at setup.
- **PROD's document list and viewer failed** with `column reference "id" is
  ambiguous` — a bare `WHERE id = …` inside a function whose output also has
  an `id`. DEV had been fixed by hand, PROD never was.
- **Five functions existed only in the databases**, including the two ingest
  writes through (`complete_document_ingestion`, `create_expiry_alert`).

**How "the same" is checked now** — a fingerprint, run on both projects,
must return identical rows: one per object type (functions with their bodies
and grants, columns, policies, RLS flags, app triggers, indexes, constraints,
table grants, the columns clients may write, buckets, categories), each with a
count and a hash. After 024 it did, for all ten types. Migration 025's
protection lives in column grants, which table grants cannot see, so they are
an eleventh type; after 025 both projects match on all eleven. The query lives
in **`qa/sql/fingerprint.sql`** — paste it into the SQL editor of each
project, or let the QA workflow compare the two for you on every run.

Run it after applying any migration to both projects. **Changing a database
by hand without a migration is what caused every item above** — if something
is applied in the SQL editor, it goes in a migration file in the same change.

Deliberately outside the check: `pg_graphql` (enabled on PROD only), its
event triggers, and a few `storage.buckets` triggers. Those come with the
Supabase platform version, not from this app.

What that recovery turned up, all of which had been invisible:

- **Storage was not scoped to a family** (019). Every policy was
  `bucket_id = 'documents'` for `authenticated`, with no check on the path —
  so any signed-in account could list, download and DELETE every family's
  files. Measured on DEV: an account owning 8 files saw all 16.
- **`create_family()` did not create the search columns** (020). Existing
  families have `embedding`/`search_vector`/HNSW only because
  `upgrade_family_schema_for_search()` was run by hand, and nothing called it.
  The next family to sign up would have had search silently broken forever.
- **PROD carried a second, four-argument `create_family`** (020). PostgREST
  resolves by exact argument names and `src/lib/api.ts` passes exactly those
  four, so the fix would have applied and done nothing. The `DROP` is
  load-bearing.
- **Twelve schema-taking RPCs were callable by any signed-in user** (022).
  See the warning at the top.
- **`REVOKE ... FROM PUBLIC` is not enough.** Migrations 013, 016 and 017 all
  did it, and the functions stayed reachable: Supabase grants `anon` and
  `authenticated` **explicitly**, so they must be revoked by name.
- **Thirteen owner-rights functions trusted a caller-supplied user id, or
  checked nothing** (023). 022 missed them because it only swept functions
  whose first argument is `p_schema`. Two of the thirteen had been restated
  with their holes intact by 020 and 021, which captured bodies without
  auditing them. **Capturing a function is not reviewing it.**
- **`get_user_notifications` has never worked** (fixed in 023). The declared
  result says `title text`, the column is `varchar`, and `RETURN QUERY`
  demands an exact match, so every call raised a type error and the
  notifications screen showed nothing — on both projects.

`supabase/migrations/` is now the source of truth. Keep it that way: anything
applied to a database belongs in a migration file, in the same change.

**Still true:** the `documents` storage bucket is created by hand in the
dashboard (no CLI, no migration), and `db dump` excludes the `storage` schema,
so storage policies live only in `019`.

### Settings writes — your own name, a switch, feedback (027)

- **Profile** writes `display_name` and `phone` on your own `users` row
  (`users_update_own` keeps it to one row) and a copy in the sign-in
  account's metadata, which is what the app reads for your own name — so the
  name changes for you even where 027 is not applied; the family sees it
  once it is.
- **Notifications** is `users.notifications_enabled`: off hides the bell's
  count and the list, and (034) sends nothing to that person's devices.
  `users.birthday_reminders` (035) is the Birthdays switch beside it, read by
  the server when it makes the day's reminders.
  Reminders are still written for every member, so switching back on shows
  them. Before 027 it is kept on the device (`preferences.tsx`'s fallback).
- **Feedback** goes to `public.feedback`: INSERT on four columns for
  `authenticated`, the sender defaulted from `auth.uid()` and checked by the
  policy, and no SELECT for any client — the team reads it in the dashboard.
  Before 027 the app says feedback is not switched on yet.
- **Storage** shows each family's plan, what it may keep and what its files
  add up to (`family_storage_status()`, 038), amber from 80%, red at the
  limit, which **the server enforces** — see
  [Plans and storage limits](#plans-and-storage-limits--every-plan-has-a-limit-038).
  Before 038 it adds up `file_size_bytes` from `get_family_documents` and
  shows the free 1 GB, unenforced. Mind the platform underneath: the
  Supabase organisation is on the **Free plan, which holds 1 GB of files per
  project in total**, all families together — PROD needs Pro (100 GB
  included, then about $0.02/GB a month) before 1 GB a family can hold for
  more than one family, and before anyone is given Plus. **Reminders** reads each document's
  details for its `expiry_date` — one call per document, fine for a family's
  papers; a large vault would want one query for it.
- **About**'s release date is stamped by `app.config.ts` when the bundle is
  built, so for a web deploy it is the day of that deploy.

### Saved chats — yours only, gone with your membership (028)

- **Ask › Save chat** keeps a conversation; the clock at the top right of Ask
  opens **Saved chats** (`src/app/saved-chats.tsx`), newest first, to carry
  one on or delete it. Nothing is kept without the button; once saved, the
  chat brings itself up to date after each answer until New question.
- **Only its owner reads it** — not the family, not an admin. `saved_chats`
  has RLS on its owner (`user_id = auth.uid()`, defaulted, never sent) and,
  for reads, inserts and updates, membership through `get_my_family_ids()`.
  Clients INSERT `family_id, title, messages` and UPDATE `title, messages,
  updated_at`, nothing else, so a chat cannot be moved to another family or
  given to another person.
- **It belongs to the membership**: a foreign key on `(family_id, user_id)` to
  `family_members` with `ON DELETE CASCADE`. Leaving a family, or being
  removed, deletes your chats about it — no function or trigger, and the
  cascade passes RLS by design. That is why deleting needed no separate
  "after leaving" rule: a delete's WHERE clause is read under the SELECT
  policy, which a former member no longer passes, so the rows go with the
  membership instead.
- **Bounded**: `messages` is a JSON array of at most 256 KB; the app keeps the
  newest 100 turns, 6,000 characters each, and each source's id and name
  only. Before 028 the app says saving is not switched on yet.

### Deleting your account — at once, nothing kept (029, 030)

- **Both stores require it in the app** (Apple 5.1.1(v); Google Play's
  account-deletion policy, which also wants a web link — the web app's
  `/settings/delete-account` is that page). Settings › Security › Delete
  account shows, family by family, what goes and what stays, and asks for
  DELETE to be typed. There is no waiting period and no copy kept.
- **A family goes with the account when nobody would be left to manage it**:
  the person is its last admin, or its last member. It goes whole — rows,
  schema, index state, files — and its other members lose it; the screen
  names them first, and points to Manage Family › Make Admin to keep it. In
  a family with another admin the person just leaves, as with Leave family,
  and the family keeps its documents, theirs included, and them in its
  family tree by name, without the account. A family they created
  passes to its longest-standing admin (`families.created_by` is ON DELETE
  RESTRICT).
- **`delete-account` is the only way in.** It takes the caller from the
  session, never the body, and calls migration 029's functions, which take a
  user id and are therefore **service role only** (point 2 at the top):
  `account_deletion_plan()` (the rule, in one place), `purge_family()`,
  `delete_account_data()` (every row, one transaction) and
  `family_storage_objects()` (a family folder's files, for the Storage API —
  direct deletes from `storage.objects` are refused).
- **The order makes failure retryable**: files first, then rows, then the
  sign-in (`auth.admin.deleteUser`, which cascades Gmail, feedback and saved
  chats). Calling again after a partial failure finds nothing and finishes.
  A Gmail permission is revoked at Google on the way, best effort.
  The device forgets what it kept for the account too (`forgetAccount()` in
  `src/lib/storage.ts`, which names every per-account key).
- **Never delete a person from the Supabase dashboard.** Before 030 that
  removed only the sign-in. The profile (email, name, phone), memberships,
  families, documents and files all stayed, and the stranded profile kept
  its email, so signing up again with it failed (`users_email_key`). DEV
  had two such profiles from March 2026. Since 030 (`users.id` references
  `auth.users` ON DELETE CASCADE), the dashboard either deletes cleanly
  (someone who created nothing) or refuses with "Database error deleting
  user" (anyone who created a family or has history 029 deletes itself).
  **Someone who cannot sign in** asks by email; delete them by hand, in
  this order:
  1. `select * from account_deletion_plan('<user id>')` — tells you which
     families go.
  2. In Storage › documents, delete each doomed family's folder
     (`storage_namespace`).
  3. `select delete_account_data('<user id>')`.
  4. Delete the sign-in: Authentication › Users.
- **Nothing left behind** is checkable: no `family_*` schema without a
  `families` row, no file in a folder without one, no `public.users` row
  without an `auth.users` row, no membership, saved chat or Gmail row for
  a missing account. All read zero on DEV after the first real deletion
  (30 September 2026), apart from the two March profiles 030 removes.

### Membership — an admin invites, only a yes joins (025, 037)

- **Before 025** the flow wrote an `invitations` row and sent a sign-up
  email, and nothing ever accepted one, so invited people never joined.
  Meanwhile the `family_members` INSERT policy ended `OR user_id =
  auth.uid()`: anyone could add THEMSELVES to any family, as admin. 025 made
  adding an admin's job, done at once; 037 makes it an invitation.
- **Asking:** `add-member` → `invite_family_member()` (service role only)
  finds the person in `auth.users` by the email they sign in with —
  confirmed, not deleted, not anonymous — and writes a `family_invites` row,
  an `invite` notification (on their devices too, 034) and an audit row, in
  one transaction. No such account → the admin is told to ask them to sign
  up, and nothing is created.
- **Answering:** the person sees which family asked and who
  (`get_my_invitations()`), on Home and in Manage Family
  (`invitation-cards.tsx`), and nothing of its documents. Accept
  (`accept_family_invite()`, the caller from `auth.uid()`) makes the
  membership as adding used to — a viewer, or under the tree entry's id
  when the invitation came from a link — and shows that family. Decline
  (`decline_family_invite()`) deletes the invitation. The family's admins
  are told either way, a no in the words they used: the address they typed.
- **Until then the family sees Pending approval** — in Manage Family, and on
  the person's page for a link — by the address it asked: the column grant
  on `family_invites` leaves out the account id, which is theirs to show by
  accepting. Any admin can withdraw it (`cancel_family_invite()`), and its
  notification goes with it. One invitation per account per family, and
  per tree entry. A membership made any other way deletes the invitation to
  it (a trigger), so nobody stays pending in a family they are in.
- **Someone already in the family tree is linked, not invited by email**
  (033). Inviting by email gives a person added by name a second entry
  beside the one with their links, documents and card, so their page has
  **Link to their FamilyVault account** for admins: `link-account` →
  `invite_family_person_account()`, service role only. See
  [Family tree](#family-tree--people-not-accounts-031).
- **Leaving needs nobody's permission.** The person sees every family they
  are in under Manage Family and can leave any of them
  (`family_members_delete_self`). The last admin cannot leave.
- **The default family never changes by itself.** `fetchUserFamilies()` is
  oldest membership first and the chosen family is remembered per device
  (`switchFamily()`), so joining somewhere never swaps the vault a person
  sees — and uploads into — behind their back. Accepting is the one switch,
  because it is their own yes.
- **Kept for the old functions:** `add_family_member()` (025) and the join
  branch of `link_family_person_account()` (033) still add at once, for the
  add-member and link-account deployed before 037, so a project whose
  functions are older keeps adding instead of failing. Nothing calls
  `add_family_member()` once both projects run this release: drop it then,
  with that branch.
- `invitations` is kept, write-locked, because the app still on PROD reads
  it. Drop it once PROD runs this release.

### Family tree — people, not accounts (031)

- **Everyone in the family, with or without an account.** `family_people`
  holds the people and `family_links` how they are related — parent, spouse
  or sibling, never a label. What someone is called depends on who is
  looking ("Your grandmother (Nani)"), so labels are computed by
  `supabase/functions/_shared/kinship.ts`, which the app, rag-search and the
  QA self-test all import: one set of rules, Hindi terms included (Dada/Dadi
  and Nana/Nani by side, Tau/Chacha by age, Bua, Mama, Mausi, Bhabhi…).
- **A member is a person under their MEMBER id.** A trigger on
  `family_members` creates the person with the membership, and 031 backfilled
  everyone already a member, so every document already marked as a member's
  (`documents.belongs_to_member`, which has no foreign key) is now marked as
  that person's, with nothing rewritten. A document can now belong to anyone
  in the tree. Leaving, or deleting the account, clears `user_id` and keeps
  the person: the family keeps its tree as it keeps its documents.
- **Members read it; admins change it; you may edit yourself.** Clients have
  SELECT (RLS through `get_my_family_ids()`) and nothing else. Writes go
  through `add_family_person`, `link_family_people`, `update_family_person`
  and `remove_family_person`, which take the caller from `auth.uid()`. The
  helpers they share (`tree_*`) are revoked from every client role.
  `update_family_person` spells out `v_user IS NOT NULL AND v_user = v_me`:
  a bare `v_user = v_me` is NULL for a person without an account, and `IF NOT
  (false OR NULL)` does not raise, which would let any member rename them.
- **The shape stays sane.** One link per pair of people (a unique index on
  the unordered pair), at most two parents, nobody their own ancestor, both
  ends in the link's family (a composite foreign key). Someone with an
  account is never removed from the tree directly: they leave through Manage
  Family. Removing a person unmarks their documents; the documents stay.
- **Brothers and sisters share parents; a sibling link is the fallback.**
  "Brother or sister of Subhendu", when Subhendu's parents are in the tree,
  is recorded as those parents' child (`person-sheet.tsx`'s plan, which says
  so before saving). A sibling link is stored only when nobody's parents are
  known. A parent added later reaches everyone sibling-linked to the child
  whose parents are a subset of the child's (`siblingsSharingParents()`), and
  the drawing places a sibling with no parents of their own beside their
  brother or sister, under that sibling's parents — so a sister added before
  Papa is never left in a branch of her own. Branch titles use the full name
  when the first word is only an initial ("K C Das Mohapatra", not "K").
- **Who is on FamilyVault shows.** A person with an account (`user_id`) gets
  a green phone badge on their avatar — in the tree, its lists, their page and
  Emergency cards (`<Avatar onApp />`, drawn from 28px up) — and a key above
  the tree says what it means. Everyone else is simply family: the tree is
  never limited to accounts.
- **One picture for everyone, always open.** Who sits where is computed from
  the whole family, never from the viewer. The screen draws every branch
  (one per pair of eldest ancestors: Papa's side, Maa's side), one below the
  other, in the same order for everyone — no tabs, nothing hidden. Only the
  viewer's own card (coral, "You") and the relation words under each name
  follow who is looking.
- **Document names come from the tree**, and only from the document's own
  family. Before 031, `get_family_documents` and `get_document_detail` looked
  a member up by id without checking the family, so a document marked with
  another family's member id showed that stranger's name.
- **Search understands relations, without a model call.**
  `relativesNamedIn()` finds the people a question names by relation, from
  the asker's place in the tree — "Nani's pension", "my mother's passport",
  "Mummy ka PAN", "नानी की पेंशन" — and rag-search adds their names to the
  search and tells the judge and the answer model who is who. It costs no
  Groq tokens and runs on every question. The documents marked as those
  people's join the candidates too (`rag_documents_for_people`, service role
  only, like every `rag_*` function), so a scan whose text never says the
  name is still found. `debug.relatives` shows what was resolved. Short or
  two-way words are deliberately not relations: "ma" is also an MA degree,
  and "mama" is a mother in English but a mother's brother in Hindi — the
  tree says which.
- **An entry without an account is linked to one when they sign up** (033):
  their page's **Link to their FamilyVault account**, admins only, by the
  email they sign in with, through `link-account` →
  `link_family_person_account()` (service role only; it takes the admin's
  user id; since 037 through `invite_family_person_account()`). Not yet a
  member, they are invited to be that entry, and when they accept they join
  as a viewer and the membership takes the ENTRY's id — the rule above — so
  links, documents and card stay put, nothing rewritten; until then the page
  shows Pending approval. Already a member (added in Manage Family, so in
  the tree twice), the two become one at once — nothing new opens up to
  them: the member's person keeps its id and takes the entry's name
  (the one the family uses), a gender or birth date it lacks, the entry's
  links — re-made through `tree_add_parent`/`tree_add_pair`, so a third
  parent or a cycle refuses the whole join with that rule's message —, the
  documents marked as the entry, and its card unless the member has one; the
  entry is deleted. A function of its own, not an option on `add-member`, on
  purpose: an older `add-member` asked to link would ADD the person again,
  the very duplicate this prevents, while a missing `link-account` answers
  the gateway's 404, which the app shows as not switched on yet.

### Emergency cards — one per person, for whoever is there (032)

- **What a doctor needs first**: blood group (the eight, and Bombay `hh` —
  rare, mostly Indian, often mistyped as O), allergies (shown on red),
  conditions, medicines, the doctor, health insurance and up to three people
  to call, each number one tap from the dialler. One card per person in the
  tree, account or not. Drawer › Emergency cards lists everyone; a person's
  page shows a summary; the full card is large on purpose — the one screen
  whose text runs past `design.ts`'s scale.
- **Every member reads every card** (RLS through `get_my_family_ids()`): in
  an emergency, whoever is there needs it. Clients write nothing directly;
  `save_emergency_card(p_person_id, p_card jsonb)` takes the caller from
  `auth.uid()` and lets an admin, or the person themselves, write — 031's rule,
  spelled out the same way. It checks every field with a message the app
  shows as it comes, and `emergency.ts` repeats the checks in the form (the
  QA self-test pins them). Blank fields are cleared; an empty card is deleted.
- **A card is about one person's health, so it goes with them**: a trigger on
  `family_members` deletes the card of whoever leaves, is removed or deletes
  their account. The family keeps the person in the tree, not their medical
  details. Taking someone out of the tree, or deleting the family, takes the
  card by cascade (a composite key to `family_people`, so a card can never
  name another family's person).
- **Not sent anywhere.** Ask does not read the cards, so no card reaches the
  AI service; answering "Dadi's blood group" from them would change that and
  needs saying in Settings › Privacy first. `users.emergency_info` (024) is
  unused and left alone.

### Reminders — once per stage, on every device that asks (034)

- **Before 034 a reminder was made only when someone opened Home**
  (`check_expiry_notifications()`), so nobody was told unless already
  looking — and it made a fresh copy of every reminder within 90 days on
  each day that someone did. Now the database's own clock does it: `pg_cron`
  (free on every plan) runs `run_reminders()` at five past every hour. From
  9 in the morning, India time, `queue_expiry_reminders()` makes each
  document's reminders for every member: 90, 30 and 7 days before (each
  expiry alert's `alert_days_before`) and on the day, until three days after.
  `reminders_sent` remembers each (document, expiry date, stage), so each
  goes once, the runs after the first find nothing, and a renewed date
  starts afresh. A document added with 20 days left gets its 30-day reminder,
  not the 90-day one it is past; one that ran out long ago gets none. Home's
  call still works, and makes the same reminders, once.
- **Devices: Web Push, free.** The browser's own push service — Google's,
  Mozilla's, Apple's, Microsoft's — carries each notification, encrypted to
  the device's own key so that service cannot read it.
  `_shared/webpush.ts` is RFC 8291 and RFC 8292 in WebCrypto, no library; the
  QA self-test checks its encryption against RFC 8291's example, byte for
  byte. Settings › Notifications › On this device turns it on, per browser
  (`src/lib/push.web.ts`); `public/sw.js` shows each notification and opens
  Notifications when it is tapped, and caches nothing. An iPhone or iPad
  allows it only to a web app on the Home Screen (iOS 16.4 or later), hence
  `public/manifest.json`, linked by `_layout.tsx` at start-up — the
  single-page export never uses `+html.tsx`, so a tag added there reaches no
  page; the screen says how. The phone app's
  `push.ts` is a stand-in until EAS builds exist (Expo push, also free).
- **`push_subscriptions` is its owner's**: RLS SELECT and DELETE on your own
  rows, written only by `save_push_subscription()` (from `auth.uid()`). An
  endpoint is one browser, so it moves to whoever signs in there. It must be
  at a real push service — a CHECK on the table, `isPushServiceEndpoint()` in
  the sender — so the server never posts to an address a client chose.
  Signing out takes the device off (`forgetPushOnThisDevice()`, in
  `auth.tsx`), Sign out everywhere takes them all, and deleting the account
  cascades.
- **The push function makes its own keys.** Its first `key` call generates
  this project's VAPID pair and keeps it, with the function's address and
  the public anon key, in `push_config` (service role only). That is the
  whole setup: no secret to set. `run_reminders()` calls `push`'s `send`
  through `pg_net` at that address when something is waiting, between 8 in
  the morning and 10 at night India time, and `send` keeps the same quiet
  hours itself — the key it is called with is public. That is safe by
  construction: `send` takes nothing from the request and sends only what
  `push_pending()` returns (a day's unread notifications of people with a
  device and notifications on), each once (`notifications.pushed_at`), with a
  lease that keeps runs a minute apart. A device the push service calls gone
  (404/410) is forgotten; a notification that met only a push service that
  was down is tried again, within the day.
- **Every notification goes to devices, not only reminders** — an
  invitation to a family too. India time only: a family abroad hears at 9 in India.
- **Birthdays (035)** ride the same clock: `queue_birthday_reminders()` tells
  every member on the morning of a birthday in the tree ("Today is Kamala
  Verma's 78th birthday"), once a year (`reminders_sent`), never the person
  themselves, 29 February on the 28th in other years, nobody over 110. Each
  person switches it off for themselves in Settings › Notifications
  (`users.birthday_reminders`, on by default, its own column grant). The tree
  has no "passed away" yet: for someone who has, an admin removes their date
  of birth — the switch's text says so.
- **Not built yet:** email (needs a paid domain); notifications in the phone
  app.

### Share links — one document, for someone outside the family (036)

- **For a tax accountant, a visa agent, an insurance agent**: someone who
  needs one document, once, and has no account. The document page's Share
  (web only) opens `share-sheet.tsx`: who it is for (optional), 1, 7 or 30
  days, Make a link. The link is shown once, with Copy link and the
  browser's own Send it…; under it the family sees every working link for
  that document, who made it and how often it was opened. Whoever made a
  link, or an admin, turns it off. Before 036 Share sent the file's raw
  storage address, which died after an hour without saying so, could not be
  turned off and left no trace.
- **The secret is after `#`** (`/s#<64 hex characters>`: two v4 UUIDs, 244
  random bits). A browser never sends that part of an address to a server,
  so no web server's log holds it. `document_shares` keeps only its SHA-256,
  and clients cannot read even that — their column grant leaves
  `token_hash` out. Nothing can show a link again, so the sheet says it is
  shown once.
- **Who may share**: an admin, whoever added the document, or the person it
  belongs to, through `create_document_share()` (the caller from
  `auth.uid()`), which also checks the document is the family's own and not
  deleted. When the document belongs to someone with an account who did not
  make the link, they get a `share` notification: who, until when, for whom.
  Making and turning off both write `audit_logs`.
- **`/s` is public**: `src/app/s.tsx`, which the AuthGate leaves alone,
  signed in or not. It calls the `share` function with the public key; the
  function hashes the secret and asks `open_document_share()` — service role
  only, since it hands out a storage path — which returns nothing once the
  link has expired, been turned off or lost its document, or its maker has
  left the family. Each open is counted and gets signed addresses that last
  five minutes, so a forwarded download address dies quickly while the link
  keeps working until its date.
- **Links go with the family, and with the account that made them**
  (cascades). A maker who only leaves keeps the row, but it no longer opens.
- **Not built yet:** links from the phone app (a link opens the web app's
  page, and only the web app knows its own address); a password on a link.

### Plans and storage limits — every plan has a limit (038)

- **What a family may keep, never unlimited**: Free 1 GB, Family Plus
  monthly 5 GB, Family Plus yearly 10 GB. Storage is the one cost that keeps
  growing after a month is paid for, so no plan is open-ended and a monthly
  plan holds less than a yearly one. The numbers are rows in `plan_limits`
  (Table editor; anyone may read them, a pricing page included) and change
  without a migration or a deploy — the app reads them
  (`fetchPlanLimits()`); `DEFAULT_PLAN_LIMITS` in `_shared/plan-text.ts` is
  only what it shows when the database cannot be asked.
- **A family is on Plus while its `family_plans` row is paid up**
  (`paid_until` in the future); otherwise, and with no row, it is on Free.
  Members read their own family's row — never `source` or `source_ref`, the
  payment company's reference, which the column grant leaves out — and no
  client can write it.
- **Plus is given by hand until payments exist**:
  `select set_family_plan('<family id>', 'yearly', now() + interval '1 year');`
  in the SQL editor. Service role only; the payment webhook will call the
  same function with `p_source` and `p_source_ref`. A new or lapsed plan
  tells the family (a `plan` notification, which opens Settings › Storage),
  a renewal is quiet, and every call writes `audit_logs`. To end a plan at
  once (a refund), delete its row. `PLUS_FOR_SALE` in `plan-text.ts` turns
  the "coming soon" words into an offer once Plus can be bought.
- **The server keeps the limit, not the app.** The `documents` bucket's
  upload policy (019's, plus `family_storage_has_room()`) refuses a new file
  once the family's files reach its limit. Used space is what the family's
  folder holds in `storage.objects` (each file's `metadata.size`), so
  Settings, the policy and Gmail import count the same bytes. A policy
  cannot see the size of the file arriving, so the last file may take a
  family past its limit by that one file (the bucket refuses files over
  50 MB). The app asks first, with the file's size (`uploadDocument` throws
  `StorageFullError`), so the person reads what is left and what to do, not
  a policy error. Gmail import uploads as the service role, which no policy
  stops, so it asks `family_storage_status()` itself before storing.
- **When Plus ends, nothing is deleted.** The family keeps, reads and
  searches every document and only cannot add more while over the free
  limit; Storage says so. Those files go on costing storage — at most a
  lapsed yearly family's 10 GB, about $0.21 a month past Pro's included
  100 GB.
- **Not built yet:** paying for Plus (a webhook calling `set_family_plan`;
  `source` allows `razorpay` and `dodo`), and a limit on questions per plan.

## Edge Functions

`supabase/functions/` — Deno, excluded from `tsconfig.json` (they use remote
`https://` imports and Deno globals that the app's TS config cannot resolve).

- **`ingest-document`** — the HTTP entry point only: it checks the caller and
  hands off to `_shared/ingest.ts`, which owns the pipeline (download →
  extract → chunk → embed → store → expiry alert). The pipeline is shared
  because the rebuild re-runs it for documents that were never indexed.
  Accepts pre-extracted OCR text from the client, or
  falls back to server-side extraction (simple PDF text parser → OCR.space).
  Chunks (500 tokens, 50 overlap, paragraph-aware) → embeds via HuggingFace
  `all-MiniLM-L6-v2` → extracts metadata (expiry dates, passport/PAN/Aadhaar/
  policy numbers) → stores via `complete_document_ingestion` → creates expiry
  alerts. Extracted text passes through `cleanText()` (`_shared/text.ts`)
  before any of that — Postgres refuses a NUL, and PDF.js emits one per glyph
  it cannot map — and `extractMetadata()` lives in `_shared/metadata.ts`.
  Both are pure (`ingest.ts` reads secrets at load time), so the QA self-test
  imports them directly.
- **`reembed-index`** — rebuilds one family's chunk vectors on the current
  embedding model, in batches, resuming from a cursor in
  `public.family_embedding_state`. Any member may read progress; only an admin
  may run it. Driven from Settings › Search.
- **`rag-search`** — resolves relations first ("Nani's pension" → her name,
  from the asker's place in the family tree; see
  [Family tree](#family-tree--people-not-accounts-031)), then embeds the query (`_shared/embeddings.ts`, same model as
  ingest) → retrieves chunks via `rag_retrieve_chunks`, which blends semantic
  distance and full-text rank 0.7/0.3 → sends chunks + query to Groq → returns
  answer plus source document references. If embedding fails the RPC falls back
  to keyword-only rather than erroring.
  **Groq models are resolved at runtime** by `_shared/groq.ts`: each role
  (answer, condense, rerank) has a preference list, a secret of the role's name
  (`GROQ_MODEL`, `GROQ_CONDENSE_MODEL`, `GROQ_RERANK_MODEL`) always goes first,
  Groq's `/models` endpoint prunes names that no longer exist, and a call that
  still hits a retired model is retried once on the next candidate.
  **The condense, translate and rerank steps all use JSON mode**
  (`response_format: {type:'json_object'}`). These are reasoning models: asked
  for a bare line they answer with their thinking ("We need to translate the
  user's message…") and the real answer is buried inside it. A JSON contract
  puts it in a field reasoning cannot occupy. `groqText()` reads `content`,
  `reasoning_content` and `reasoning` and strips channel markers, because the
  text is not always where you expect. Groq
  retires free-tier models on short notice (`llama-3.3-70b-versatile` in June
  2026, `llama-3.1-8b-instant` in August 2026) — when adding a fallback, confirm
  the name on Groq's models page first. The models that actually ran are
  returned in `debug.models` and shown under follow-up answers.
  **Voice / language:** the request may carry `language` (BCP-47) and
  `voice: true`. A non-English question is condensed *into English* before
  retrieval (the index is English) and the answer is written in the person's
  language; `voice` asks for short spoken sentences with no markdown. The
  response echoes `answer_language`.
- **`add-member`** — a family admin invites a person who already has an
  account, by email: checks the caller is an admin, then calls
  `invite_family_member()` (037) as the service role. Answers 200 `invited`,
  404 `no_account`, 409 `already_member` or `already_invited`, and 503
  `needs_migration` where 037 is not applied; see
  [Membership](#membership--an-admin-invites-only-a-yes-joins-025-037).
  It replaced `invite-member`, which the deploy workflow deletes from each
  project it deploys to — a function removed from the repo otherwise stays
  live, running its old code.
- **`link-account`** — a family admin links someone already in the family
  tree to the account they have since made, by email (033; see
  [Family tree](#family-tree--people-not-accounts-031)), through
  `invite_family_person_account()` (037). Answers 200 `invited` (not yet a
  member: an invitation to be that person) or `merged` (already a member:
  the two entries are one now), 404 `no_account`/`no_person`, 409
  `already_linked`, `already_member`, `already_invited` (someone else is
  asked to be that person) or `tree_rule` (with the rule's own words), and
  503 `needs_migration` where 037 is not applied.
- **`push`** — notifications on devices (034; see
  [Reminders](#reminders--once-per-stage-on-every-device-that-asks-034)):
  `key` and `test` for a signed-in person, `send` for the hourly clock (open
  by design: it reads nothing from the request and returns only counts).
  503 `needs_migration` where 034 is not applied.
- **`share`** — opens a share link for someone with no account (036; see
  [Share links](#share-links--one-document-for-someone-outside-the-family-036)):
  the link's secret in, its SHA-256 looked up by `open_document_share()`,
  two five-minute signed addresses out (view and download). 404 `gone` for
  a link that expired, was turned off, lost its document or its maker — or
  never existed, so the answer tells a guesser nothing; 503
  `needs_migration` where 036 is not applied.
- **`delete-account`** — a person deletes their own account: `preview`
  lists what would go, `delete` with `confirm: 'DELETE'` does it; see
  [Deleting your account](#deleting-your-account--at-once-nothing-kept-029).
  503 `needs_migration` where 029 is not applied.
- **`gmail-connect`**, **`gmail-callback`**, **`gmail-scan`**,
  **`gmail-import`** — Gmail import; see [below](#gmail-import--your-own-mailbox-your-tick-026).

All of them handle CORS preflight explicitly.

### Gmail import — your own mailbox, your tick (026)

A person connects their OWN Gmail; FamilyVault lists the attachments that
look like documents; they tick what to keep; each ticked file goes through
the normal ingestion. Nothing is imported without a tick, and no model reads
anyone's email: Gmail's own search makes the first cut (`SCAN_QUERY`) and
rules sort the rest (`_shared/gmail-rules.ts`).

- **Four functions.** `gmail-connect` (status / start / finish /
  disconnect), `gmail-callback` (Google's redirect target), `gmail-scan`
  (25 emails per call, resumable: Gmail's page token and a lease in
  `gmail_connections`), `gmail-import` (ONE attachment per call — the CPU
  budget is seconds). Shared code: `_shared/gmail.ts` (Google),
  `_shared/gmail-rules.ts` and `_shared/gmail-crypto.ts` (pure; the QA
  self-test runs them in Node).
- **`gmail-callback` is the only function deployed without JWT
  verification** (`--no-verify-jwt`, in the deploy workflow): Google's
  redirect carries no Supabase session. So it does nothing that needs one —
  it relays the browser to the page that started the flow. Never give it
  another job. QA fails if it is deployed with the check.
- **A token lands only with the account that asked.** The risk is consent
  phishing: a link started by one account, approved by someone else, would
  hand their mailbox to the first account. `finish` claims the state row
  only for the account that created it, once, within ten minutes; Google's
  code only ever returns to an origin in `GMAIL_RETURN_ORIGINS`; and PKCE's
  verifier never leaves the database. Loosen none of the three.
- **Refresh tokens are sealed** (AES-256-GCM, key in `GMAIL_TOKEN_KEY`, never
  in the database) and access tokens are never stored. Rotating the key
  disconnects everyone.
- **Service role only.** `gmail_oauth_states`, `gmail_connections` and
  `gmail_import_items` have RLS on, no policies, and every client grant
  revoked. What a scan finds is visible to the person whose mailbox it is,
  through the functions, and to nobody else — not their family.
- **Metadata until import.** Sender, subject, file name, size. No email body
  is ever stored, and Gmail's attachment ids are not kept (they change on
  every fetch); the import looks the part up again, checks the bytes are a
  PDF/JPEG/PNG (`sniffType`), and skips a file whose SHA-256 was already
  imported into that family.
- **Web only, and "Testing" on Google's side.** The phone app would need an
  auth session and a `familyvault://` redirect, unverifiable without a
  native build. While the Google Cloud project is in Testing, only its listed
  test users (at most 100, ever) can connect, and Google expires their
  refresh tokens after 7 days — `expired` in the app, "Reconnect" resumes
  the scan where it stopped. A public launch needs Google's verification of
  the restricted `gmail.readonly` scope, including a paid security
  assessment. Use a Google Cloud project separate from the sign-in one, so
  sign-in never inherits the unverified status or the cap.
- **Imported photos are OCR'd on the server** (OCR.space, English only),
  not in the browser in the family's languages as an upload is.
- **It stops at the family's storage limit** (038). Import stores as the
  service role, which no storage policy stops, so it asks
  `family_storage_status()` first and refuses a file that does not fit, in
  the same words as an upload (`_shared/plan-text.ts`).

### PDF text — read by position, not by content-stream order

`_shared/pdf-text.ts` extracts PDF text with PDF.js (`pdfjs-serverless`, a
single-file build for runtimes without a filesystem) and rebuilds the page
layout from coordinates.

- **A PDF has no lines, paragraphs or table rows** — only glyphs at positions,
  written in whatever order the producing program chose. Reading that stream
  in order returns a table COLUMN BY COLUMN. The placements report stored
  `Operations` and its `27 - 44` two hundred characters apart with nine other
  functions in between, so no question about a row was answerable.
- `reconstructLayout()` groups pieces sharing a baseline, orders them left to
  right, and emits two spaces at a visible column gap. It is pure and
  synchronous **on purpose**: the ordering rules are the fragile part, and
  they can be exercised without a PDF engine.
- Paragraph breaks compare against the page's **median line step**, not the
  font size. A table on 22-unit rows in 10-point type is a table, not a page
  of one-line paragraphs, and judging by font size says otherwise.
- Fallbacks, in order: layout extraction → the old regex parser (no positions,
  so no tables) → OCR.space. A PDF with no text layer yields nothing from the
  first two, which is the signal that it is scanned.
- `EXTRACTOR_VERSION` in `_shared/ingest.ts` records which reader produced a
  family's stored text. Bumping it re-runs extraction over stored PDFs, the
  same way changing the embedding model re-runs embedding.

### Known issues found by QA

The QA suite reports these on every run (🐞) until they are fixed; each
check passes by itself once the defect is gone.

- **Browser-made PDFs in every Indian script lose letters in the server's
  text layer** — measured on Hindi and the eight other languages the app
  offers. pdfjs-serverless emits U+0000 for glyphs with no ToUnicode mapping
  (conjuncts, reph, the pre-base vowel sign, which `cleanText()` then
  strips), and stores vowel signs drawn before their consonant in drawing
  order: "आशा वर्मा" is stored as "आशा वमा", "ಠೇವಣಿ" as "ೕವಣಿ", "தென்னகர்" as
  "ெதன்னகர்". Names suffer most: of four canary words per document, Hindi,
  Bengali, Telugu and Kannada lose all four, Tamil and Malayalam three,
  Marathi, Gujarati and Punjabi two. Digits and Latin text survive, so
  amounts, dates and ID numbers are still found. Poppler reads the Hindi
  file correctly, so this is the reader, not the file. The server's OCR
  fallback is English-only, so it cannot rescue these either. Found by
  `qa/tools/check-fixtures.mjs`; suite `languages` measures what it costs
  at answer time. Photos are not affected on the web: Tesseract in the
  browser reads the names intact. Inside a Tamil read it does misread the ₹
  and an account number's Latin letters, though not the digits.

**Fixed in the ingest code, and reported until DEV runs it** — each then
reads ✅ by itself, and the offline self-test guards the first two:

- **Every DD/MM/YYYY expiry was stored twice, once truncated** ("17/10/2026"
  and "17/10/20"), and the document viewer showed both. The YYYY-first
  pattern in `extractMetadata()` (`_shared/metadata.ts`) now needs a
  four-digit year.
- **That Hindi PDF did not ingest at all.** PDF.js emits U+0000 for the
  glyphs it cannot map, Postgres refuses a NUL in `text`/`jsonb`, and
  `complete_document_ingestion` failed (HTTP 500), leaving it `pending`.
  `cleanText()` (`_shared/text.ts`) strips it before anything is stored. The
  letters above are still lost until the reader changes, but the document is
  searchable by its amounts, dates and numbers.
- **For images, an OCR outage looked like a bad file**: the OCR error was
  dropped, so a 503 read "Nothing readable could be extracted" and was not
  `retryable`. Images keep the reason now; the retryable rule is under
  [A scan is told from a text layer](#a-scan-is-told-from-a-text-layer-per-page-not-per-document).

### Chunking — sized to the model's window, not to taste

`_shared/chunking.ts` owns the splitter for ingest and for the rebuild.

- **The embedding model reads 512 tokens and silently ignores the rest.** A
  chunk longer than that is embedded from its opening only: the tail is in the
  database, findable by keyword, invisible to a question asked in other words.
  This vault had chunks averaging ~1,750 characters and reaching 3,642, so most
  passages were partly outside the window. Target is 320 tokens, hard ceiling
  400.
- **Tokens are not characters, and the ratio depends on the script.** "1 token
  ≈ 4 characters" holds for English and is roughly double the truth for
  Devanagari, Bengali and Tamil, where the tokenizer emits a token every 1-2
  characters. `estimateTokens()` counts non-ASCII at double weight, so Indic
  documents chunk smaller by themselves. Sizing Hindi by the English rule
  overflows the window badly.
- **The cascade matters more than it looks.** Paragraphs → lines → sentences
  (including the danda `।`) → clauses → a hard cut. OCR output often has no
  blank lines and sometimes no punctuation at all; the previous splitter gave
  up on exactly that case and emitted one enormous chunk.
- Changing the target means re-splitting stored documents: migration 016's
  `rechunked_at` drives that as the first phase of `reembed-index`.

### Embeddings — one model, two prefixes, one registry

`_shared/embeddings.ts` owns the model for **both** ingest and search;
neither calls HuggingFace directly. Three things matter:

- The model is `intfloat/multilingual-e5-small` (384 dims, MIT, 100 languages).
  It replaced the English-only `all-MiniLM-L6-v2`, which gave Hindi and other
  Indian-language passages meaningless vectors. Same dimension, so the
  `vector(384)` column and HNSW index were never touched.
- **E5 requires prefixes.** Passages are embedded as `passage: …` and questions
  as `query: …`. Omitting them degrades retrieval sharply and silently. Use
  `embedPassages` / `embedQuery`, never a raw call.
- **The endpoint moved, and the silence cost us the whole feature.**
  `api-inference.huggingface.co` now answers `410 Gone`; HuggingFace serves
  inference from `router.huggingface.co`. Every chunk in the live vault sat
  with a NULL embedding for the life of the project because of it, and the
  only sign was a `console.warn`. `embedPassages` / `embedQuery` now return
  the reason alongside the vectors, callers surface it (`debug.embed_error`
  in search, an error on the Settings › Search row, `console.error` in
  ingest), and the host is a list to try rather than one name to be wrong
  about. A token is now required — `HF_API_TOKEN` must be set.
- **Query and chunk vectors must come from the same model.** Mixing ranks by
  noise instead of failing. `public.family_embedding_state` (migration 013)
  records which model a family's chunks use and whether the rebuild finished;
  until it has, `rag-search` sends no query vector and retrieval falls back to
  keyword-only. A family with no row was created after 013 and is ready by
  definition. **Changing the model means bumping it here and re-running
  `reembed-index` for every family.** The search screen starts that rebuild
  by itself when an answer reports `debug.index_rebuilding`, so nobody has to
  find the Settings row for search to work; Settings › Search remains the
  manual route and the place errors are shown in full. **`rag-search` also
  starts one server-side**, after its response, whenever it sees a stale
  index — the client path depends on the browser having the current bundle,
  and a stale one leaves the vault with no vectors indefinitely. The work is
  shared in `_shared/reembed.ts` and takes a lease (a conditional update on
  `updated_at`) so parallel searches cannot trample one cursor.
- **The rebuild has four phases, and the order is forced.**
  1. **Re-extract** stored PDFs when `extractor_version` has moved. Downloads
     every file, so much the slowest; first because it rewrites text *and*
     chunks, discarding anything the later phases had done.
  2. **Retry** documents that were never indexed (migration 017).
  3. **Re-split** from `documents.ocr_text` with the current splitter — pure
     text work, no OCR and no network, so it is cheap.
  4. **Embed.** Last because splitting decides what the chunks *are*, so
     embedding before it would be wasted.

  Each phase has its own cursor (`reextract_cursor`, `rechunk_cursor`,
  `cursor_id`), so a run can stop anywhere and resume.
- **Documents with no chunks are retried, then reported.** The rebuild's first
  phase gives each one a single attempt through the full ingest pipeline
  (migration 017). It is bounded by construction: a document that yields text
  leaves the list by gaining chunks, and one that yields none is marked
  `failed` and never tried again, so this can never become work repeated on
  every search. What is left, `rag_unindexed_documents` lists and the app
  names. This vault had a PDF stuck at `ingestion_status = 'pending'` for a
  month, never searchable, with nobody told.
- **Nothing readable means no chunk.** An unreadable file used to be stored
  with a `[Document: name]` placeholder chunk, which is indistinguishable from
  a real passage at search time and hides the failure. `ingestDocument` now
  returns `empty: true` and the caller marks the document instead.

### A scan is told from a text layer PER PAGE, not per document

"Did any text come out?" cannot distinguish them. A scanned PDF carries a
digital-signature stamp, and one line of `Digitally Signed by …` per page
looks exactly like a document that was read. `Harrier Insurance 2026-27.pdf`
sat in this vault for a month looking ingested on the strength of 149
characters that were *entirely* that stamp — and because the old test was
"more than 50 characters in the whole document", OCR was never attempted.

- `hasTextLayer()` in `_shared/ingest.ts` requires **200 characters per page**
  (`MIN_CHARS_PER_PAGE`), so `extractPdfLayoutText` returns the page count
  alongside the text. A page of prose or a table runs to hundreds of
  characters; a stamp runs to a few dozen. Averaging over the document keeps
  one sparse page from condemning a good file. 200 rather than 100 because
  149 characters clear 100 if the file turns out to be a single page.
- **Over-triggering is harmless by construction:** the OCR result is kept only
  when it reads *more* than the text layer did, so a genuinely sparse page
  keeps its own text and only a real scan is replaced.
- **A scan OCR cannot rescue is reported, not stored.** `thin: true` comes
  back with a reason, and `ingestDocument` returns `empty` rather than storing
  a signature stamp as a passage — the same failure the placeholder chunk
  caused.
- **An OCR failure that is not the document's is not a bad document**, and
  the two must not look alike. `OCR_SPACE_API_KEY` missing is fixed by
  setting a secret; OCR.space answering 5xx or 429, timing out or being
  unreachable, by waiting; an unreadable file only by replacing it. The first
  two come back `retryable: true` — images as well as PDFs — and the rebuild
  does **not** mark such a document permanently failed, so the secret, or a
  later run, is enough to make it readable.

### RAG pipeline

**OCR is English-only in one remaining place:** the server-side OCR.space
fallback, used for PDFs whose text could not be extracted. An unrecognised
language code fails that request outright, so it stays on `eng`. Images are
OCR'd on the client in the chosen languages; a *scanned Indian-language PDF*
is the case still limited to English.

```
INGEST  upload → client OCR (Tesseract web / ML Kit native) → upload file + text
        → ingest-document → OCR.space fallback if needed → chunk → embed
        → document_chunks (+vectors) + document_metadata → expiry alerts

SEARCH  question → rag-search → embed query → retrieve chunks
        (0.7 semantic + 0.3 keyword) → Groq → answer + source docs
```

**Retrieval fetches 40 and judges 15, with no document allowed more than 4 of
those slots.** The cap is applied **in SQL** (`rag_retrieve_chunks`'s
`p_per_doc`, migration 015) because applying it to the rows the RPC returns is
too late: when one document supplies every row there is nothing left to
diversify with. Measured on the live vault, for `what | arpita | mobile |
number`, 36 of the top 40 keyword hits were a 111-chunk tax return — Indian tax
forms say "mobile" and "number" on every page — and the resume carrying the
actual number scored zero slots. `diversify()` in `rag-search` applies the same
rule again once pinned chunks are mixed in.

---

## Conventions

- **Styling: React Native `StyleSheet` only.** No NativeWind, no Tailwind.
- **Sizes come from `src/constants/design.ts`: one compact scale.** People
  said the screens looked inconsistent and too big — 17-18px text and 52px
  fields on Settings, 13px beside them elsewhere — so every screen now takes
  its type, control heights, spacing and radii from one file. Use its
  tokens, not new numbers:
  - **Text, one size per job:** screen title 17/600, heading 16/600, body
    and row labels 15, secondary lines 13, badges, tags and section labels
    (`overline`, uppercase) 12. Nothing in the app is smaller than 12.
  - **Controls:** buttons and text fields 44 tall (Apple's smallest touch
    target), list rows 56, selection chips 40, icon boxes 32, icons 24 in a
    bar and 16 in a row.
  - **Spacing** 4/8/12/16/24, screen gutter 16; **radius** 12 for controls
    and list rows, 16 for cards.

  Colours are hex literals in older files; `color` in `design.ts` holds the
  same values: primary `#2A3D66`, secondary `#4A6491`, accent `#D4807B`,
  background `#F8F9FC`, dark bg `#0D1117`, dark card `#161B22`.
  `src/constants/theme.ts` is the untouched `create-expo-app` scaffold
  (generic `Colors`/`Fonts`/`Spacing`) and the FamilyVault screens do **not**
  read from it — don't assume editing it changes anything.
- **Shadows: use `boxShadow`, never `shadow*`.** RN 0.84 / SDK 55 deprecate
  `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` on web and warn
  loudly. Keep `elevation` for Android.
  Example: `boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)'`.
- **Icons:** `@expo/vector-icons`, Feather set. Feather has no fingerprint
  glyph — biometric UI uses `"aperture"`.
- Screens use `SafeAreaView` with `edges={['top']}`.
- **Every screen but Home opens with `<ScreenHeader title fallback right />`**
  (`src/components/screen-header.tsx`), the Ask and Upload tabs included,
  and shows it while the screen loads too. It is the platforms' own top bar:
  56 tall, a plain back arrow at the left (`<BackButton />`: 24px drawn, 44px
  to touch, heard as "Go back"), the title beside it, and on the right at
  most one labelled `HeaderButton` (like Manage Family's Add) or up to two
  `HeaderIconButton`s in `HeaderActions` (Ask: New question and the Saved
  chats clock, which never moves).
  Creating a second vault, which has its own centred title, shows the arrow
  alone in the same place. An earlier outlined "Back" button on its own row
  above the title was tried and rejected as heavy. The arrow goes Home (or
  the screen's `fallback`) when there is no history — `router.back()` alone
  does nothing after a web refresh or on a screen opened from a link, which
  is how Settings came to have no way back at all and Notifications and the
  document viewer a button that did nothing.
- **A row or button that opens nothing is not shown.** Settings once listed
  six rows with an arrow that went nowhere, and the document viewer had a
  menu button with no menu. Add the control when its screen exists.
- **★ Family Plus marks what the paid plan will include** (`<PlusTag />`).
  Since 038 the plan exists — a family on it has more space, 5 GB monthly or
  10 GB yearly, given by hand until payments exist — but it cannot be bought
  yet, so space is the only thing it changes: Reminders (in the drawer;
  since 034 they really are sent) and Import from Gmail (on Upload) work for
  everyone and say the paid version is coming. Each shows the tag where you
  find it, and Help's FAQ names all three. Every plan, Free included, has a
  storage limit the server keeps (see
  [Plans and storage limits](#plans-and-storage-limits--every-plan-has-a-limit-038)).
- **Never give a web panel `flex` for its width.** On react-native-web
  `flex: 1` fills the row and `flex: 0` collapses it, whatever `width` says.
  The old profile drawer filled the whole page that way, which is why it
  looked like a screen rather than a drawer. A width alone is what native does.
- Use `as any` on `router.push`/`replace` for routes typed routes don't cover
  (e.g. `router.replace('/home' as any)`).
- Re-fetch on focus with `useFocusEffect`, not `useEffect` — plain `useEffect`
  leaves lists stale after a delete on another screen.
- **Language settings are two separate things.** Settings › Accessibility ›
  *Voice language* is what the person speaks and hears. Settings › Documents ›
  *Document languages* is what OCR reads off the page. A family can speak
  Hindi and hold English papers, or the reverse, so never collapse them into
  one setting.
- **Voice mode** (Settings › Accessibility) is built for elderly users: one
  big control, one state at a time, everything spoken is also shown. Keep the
  four mic states (idle / listening / thinking / speaking) and never add a
  step that needs a second tap to get an answer. Strings the app itself says
  live in `voice-languages.ts` with English and Hindi; other languages fall
  back to English.

---

## Environment notes

Historically developed in **Firebase Studio** (`.idx/dev.nix`: Node 20, JDK 21,
Gradle; web preview on port 9002 proxied through 9000; Android via
`adb -s emulator-5554`). That config is retained but is not required — the
project builds on any machine with Node 22 and npm.

`react-native-devtools` fails to install in the Nix sandbox
(`libglib-2.0.so.0` missing). Harmless; does not affect the web preview or app
functionality.
