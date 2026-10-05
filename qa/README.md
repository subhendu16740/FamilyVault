# FamilyVault QA

Uploads synthetic **SPECIMEN** documents to the **DEV** project, asks questions
about them, and checks the answers — plus the database, access and upload
checks that guard the failures this project has actually had. It runs in
GitHub Actions (`.github/workflows/qa.yml`); nothing here ships with the app.

## What a run checks

| Area | Checks | Spends |
|---|---|---|
| Database | 023 sweep is zero rows on DEV and PROD; the 024 fingerprint matches between them | nothing (read-only catalog queries) |
| Setup | QA Vault A holds all 17 SPECIMEN documents, indexed (uploaded once, on the first run) — English, Hindi, and one or two in each of eight more Indian languages, whose two photos are OCR'd the way the web app does it before upload (see [Indian languages](#indian-languages)) | first run only |
| Access | 134 probes: a logged-out visitor and account B (another family) are refused by every app RPC, the server-only RPCs, all Edge Functions (Gmail import's too: no one reads another's connection or findings, gmail-callback redirects nowhere for a state it never issued, and a consent link never returns to a site off the allowlist) and storage, and B cannot rewrite the columns 025 locked (its own `is_superuser` and email, a family's storage namespace) or create user, family or membership rows, rename account A, or send feedback as someone else or read anyone's (027; skipped until it is applied), or read, add to, change or delete another account's saved chats (028; skipped until it is applied), or reach account deletion's database functions or another account's deletion preview (029; skipped until it is applied and deployed), or read, add to, rename, connect or remove anyone in another family's tree, write the tree's tables directly or list documents by person (031; skipped until it is applied), or read, change, delete or directly write another family's emergency cards (032; skipped until it is applied), or link anyone in another family's tree to an account, through `link-account` or its database function (033; skipped until it is applied and deployed), or turn on, list or remove anyone's notification devices, get the notification key or send a test without signing in, or reach the server-only reminder and push functions (the keys, the waiting notifications, the reminder clock; 034, skipped until it is applied and deployed), or switch off account A's birthday reminders or make the day's birthday reminders (035; skipped until it is applied), or read a family's share links, make one, turn one off, reach the database function that opens one, or open a link with a made-up secret (036; skipped until it is applied and deployed), or read a family's invitations, list or accept invitations without signing in, accept, decline or withdraw an invitation that is not theirs, or reach the server-only functions that ask (037; skipped until it is applied), or read another family's plan or storage, ask whether it has room, give a family Family Plus, write a plan directly or raise a plan's limit (038; skipped until it is applied), or end a family's Plus, make the notices, or claim, take from or close a removal — and the plans function, open by design, removes nothing of account A's (040; skipped until it is applied and deployed), or use up or read another family's answers read aloud, ask which plan a family is on, or raise a plan's member limit (041; skipped until it is applied) — each with a positive control (for 038, A's own family has a limit, its files are counted and it has room; for 041, A reads every plan's limits and claims an answer read aloud for its own family, never past its plan's number), and for share links A's own link opens without an account, its secret's hash stays unreadable, and once A turns it off it is gone | nothing |
| Members | only an admin asks (`add-member`), and only a yes joins (037): A invites B — B is not a member, sees nothing of the vault, is told by an "invite" notification and sees which family asked; A sees it as Pending approval, inviting again says so, and A cannot accept for B; B says no (the invitation goes, A is told), is invited again and says yes (a viewer now, A is told; an add-member deployed before 037 adds at once, and those checks skip, saying so); "already a member" and "no account" are reported; B, now an insider, cannot make itself admin, give itself delete rights, delete A's document, add members, remove A or rename the vault; B becomes a person in the family tree, sees it, cannot change it but may edit its own details (031); B writes its own emergency card, reads the family's and cannot change the admin's (032); B, a viewer, cannot link anyone to an account, or share A's document by link (036), and A linking an entry added by name to B makes the two one person at once (033); B can leave, and stays in the tree without the account, its emergency card deleted; A linking that person to B's account again invites B to be it, B is told, and B's yes brings B back as it, under the same id (037); then B leaves again and the check takes the person out | nothing |
| Upload | a fresh PDF goes through storage → insert → ingest-document; chunks, vectors, metadata, expiry alert → notification, made once however often Home asks (034); a password-protected PDF fails visibly | 1 small embedding call, 1 OCR request |
| Index | no unindexed documents; index up to date | nothing |
| Questions | answers carry the right facts from the right document; refusals; Hindi; follow-ups; voice; a relation ("my mother's passport") named through the family tree; with suite `languages`, eight more Indian languages | Groq — see below |

## Groq budget

Each question costs about 9K tokens, ~6.5K of them on the relevance judge
(`openai/gpt-oss-20b`, free tier: 8K tokens/minute, 200K/day). So:

- **smoke** (3 questions) after each deploy to DEV and on pushes to `qa/`;
  **nightly** (8–9 questions: smoke + core + one rotating group) at 03:10 IST;
  **full** (16), **languages** (12, about 43% of the free day on its own)
  and **no-questions** (0) by hand. `languages` is never scheduled and
  `full` does not include it; don't run both on one day.
- At most two question-asking runs a day outside the nightly one; later runs
  that day do only the free checks. One run at a time.
- Questions go one at a time, 90s apart (`QA_SPACING_SECONDS`), back off on a
  rate limit, and stop if Groq pushes back twice. Rate-limited = inconclusive,
  not asked = deferred; neither fails the run.

Worst day: ~100K tokens on gpt-oss-20b (half its free day) and ~40K on
gpt-oss-120b, the model people's answers come from.

## Indian languages

The app offers nine Indian languages besides English, for voice (Settings ›
Accessibility) and for reading documents (Settings › Documents). QA Vault A
holds a Hindi notice and, per suite `languages`, one household document in
each of the other eight — Bengali, Tamil, Telugu, Marathi, Gujarati,
Kannada, Malayalam, Punjabi — plus a Tamil and a Gujarati **photo** of the
same kind of bill for someone else, so that naming one person must never
return the other's amount.

What each path reads, measured by `tools/check-fixtures.mjs` on every run:

| Path | Indian-script text | Notes |
|---|---|---|
| PDF, read on the server (pdfjs-serverless) | **damaged in every script** — names and labels lose letters (Hindi, Bengali, Telugu, Kannada 4 of 4 canary words; Tamil, Malayalam 3; Marathi, Gujarati, Punjabi 2) | amounts, dates and account numbers in ASCII survive |
| Photo, web app (Tesseract in the browser, chosen languages + English) | read well — names intact | inside a Tamil read, ₹ → `*` and `TN-WT-61407` → `1110/1-61407`; digits survive |
| Photo, phone app (ML Kit) | Latin only | not tested here |
| Scanned PDF (server OCR.space) | English only | not tested here |

`lib/client-ocr.mjs` reads a `clientOcr` photo exactly as the web app does —
the tesseract.js version it pins, LSTM mode, and the models it would fetch
from jsDelivr (`@tesseract.js-data/<lang>/4.0.0_best_int`), installed from
npm so a run never depends on the CDN — and the text goes up with the file,
as `ocr_text`, as the app sends it.

The 12 questions ask by name, as a family would, in the two ways the search
screen sends them: **voice mode** carries `language` and `voice`, so the
question is translated to English for retrieval and answered aloud in the
language (checked: `answer_language`, the script, no markdown); **typed**
questions carry no language at all — the app sends one only in voice mode —
so they are searched as written and the answer's language is not judged.
Two more ask in English about a Bengali and a Kannada document.

## Results

`pass` · `fail` (the run goes red) · `known` 🐞 (a real, understood defect —
reported every run without turning it red, passes once fixed) · `inconclusive`
· `deferred` · `skipped`. The Actions summary shows the table; the
`qa-results-*` artifact holds `results.json` with every answer, its sources
and rag-search's debug block.

## Running it

```bash
cd qa && npm ci
node run.mjs --plan --suite nightly      # what would run; no network
node tools/selftest.mjs                   # matchers, judge, budget; offline
node tools/check-fixtures.mjs             # fixtures read as the tests assume; offline

# live, against DEV (PROD is refused):
export QA_SUPABASE_ANON_KEY=… QA_A_EMAIL=… QA_A_PASSWORD=… QA_B_EMAIL=… QA_B_PASSWORD=…
export SUPABASE_ACCESS_TOKEN=…            # optional: the database checks
node run.mjs --suite smoke
```

## Changing things

- **A question:** edit `questions.yaml`. Facts must come from
  `fixtures/documents.mjs`; run `tools/selftest.mjs` — it rejects a suite
  that would exceed its budget.
- **A document:** edit it in `fixtures/documents.mjs`, bump
  `FIXTURE_VERSION` and the `_vN` in its file name, then `npm run fixtures`
  (needs `npm install` and, for the locked PDF, `pip install pypdf`) and
  `npm run check:fixtures`. The runner replaces the old copy in QA Vault A.
  `npm run fixtures` draws only files that do not exist yet (`-- --force`
  redraws them all), so adding one never changes the bytes of the others.
  A photo with `clientOcr` needs each language's `@tesseract.js-data/<code>`
  package in `package.json` (a dependency, not a devDependency: CI installs
  with `--omit=dev`).
- **Every document is fictional and says so.** This repository is public:
  never add a real document, not even an old one.

## Known issues it reports

- The server's PDF reader (pdfjs-serverless) damages every Indian script in
  browser-made PDFs: glyphs with no ToUnicode entry come out as U+0000 and
  are stripped (conjuncts, reph, the pre-base vowel sign — "आशा वर्मा" reads
  as "आशा वमा", "ಠೇವಣಿ" as "ೕವಣಿ"), and vowel signs drawn before their
  consonant are stored in drawing order ("தென்னகர்" as "ெதன்னகர்").
  Reported by `check-fixtures` on every run, one line per reader.
- Browser OCR of a Tamil photo misreads the ₹ and an account number's Latin
  letters; the digits survive.

Three more are fixed in the ingest code and read 🐞 only while DEV still runs
the old function; they turn ✅ by themselves once it is deployed:

- a second, truncated expiry for every DD/MM/YYYY date ("17/10/2026" and
  "17/10/20") — `_shared/metadata.ts`, guarded by the self-test;
- that Hindi PDF failing to ingest at all (a NUL Postgres refuses) —
  `cleanText()` in `_shared/text.ts`, guarded by the self-test;
- an OCR.space outage on an image reported as "Nothing readable could be
  extracted", and not retryable.

The membership probes (Access and Members) fail or skip until migration 025
is applied to DEV and `add-member` is deployed there: before that, account B
really can make itself superuser, and the checks say so. Since 037 the new
`add-member` needs that migration too: merged before it is applied, adding
answers "needs a database update" and the Members checks skip, saying so.

OCR.space itself answering 5xx is treated as **inconclusive** (an outage
outside the app), and a question whose document is not indexed is
**skipped** rather than asked, so one failure is reported once.
