# FamilyVault QA

Uploads synthetic **SPECIMEN** documents to the **DEV** project, asks questions
about them, and checks the answers — plus the database, access and upload
checks that guard the failures this project has actually had. It runs in
GitHub Actions (`.github/workflows/qa.yml`); nothing here ships with the app.

## What a run checks

| Area | Checks | Spends |
|---|---|---|
| Database | 023 sweep is zero rows on DEV and PROD; the 024 fingerprint matches between them | nothing (read-only catalog queries) |
| Setup | QA Vault A holds all 7 SPECIMEN documents, indexed (uploaded once, on the first run) | first run only |
| Access | 39 probes: a logged-out visitor and account B (another family) are refused by every app RPC, the server-only RPCs, all Edge Functions and storage, and B cannot rewrite the columns 025 locked (its own `is_superuser` and email, a family's storage namespace) or create user, family or membership rows — each with a positive control | nothing |
| Members | only an admin adds (`add-member`): A adds B as a viewer, B is notified and sees the vault; "already a member" and "no account" are reported; B, now an insider, cannot make itself admin, give itself delete rights, delete A's document, add members, remove A or rename the vault; B can leave | nothing |
| Upload | a fresh PDF goes through storage → insert → ingest-document; chunks, vectors, metadata, expiry alert → notification; a password-protected PDF fails visibly | 1 small embedding call, 1 OCR request |
| Index | no unindexed documents; index up to date | nothing |
| Questions | answers carry the right facts from the right document; refusals; Hindi; follow-ups; voice | Groq — see below |

## Groq budget

Each question costs about 9K tokens, ~6.5K of them on the relevance judge
(`openai/gpt-oss-20b`, free tier: 8K tokens/minute, 200K/day). So:

- **smoke** (3 questions) after each deploy to DEV and on pushes to `qa/`;
  **nightly** (8–9 questions: smoke + core + one rotating group) at 03:10 IST;
  **full** (15) and **no-questions** (0) by hand.
- At most two question-asking runs a day outside the nightly one; later runs
  that day do only the free checks. One run at a time.
- Questions go one at a time, 90s apart (`QA_SPACING_SECONDS`), back off on a
  rate limit, and stop if Groq pushes back twice. Rate-limited = inconclusive,
  not asked = deferred; neither fails the run.

Worst day: ~100K tokens on gpt-oss-20b (half its free day) and ~40K on
gpt-oss-120b, the model people's answers come from.

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
- **Every document is fictional and says so.** This repository is public:
  never add a real document, not even an old one.

## Known issues it reports

- The server's PDF reader (pdfjs-serverless) drops Devanagari conjuncts, reph
  and the pre-base vowel sign from browser-made Hindi PDFs — "आशा वर्मा" reads
  as "आशा वमा". Reported by `check-fixtures` on every run.

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
really can make itself superuser, and the checks say so.

OCR.space itself answering 5xx is treated as **inconclusive** (an outage
outside the app), and a question whose document is not indexed is
**skipped** rather than asked, so one failure is reported once.
