# FamilyVault - Project Context

## What is this project?
FamilyVault is an Expo React Native app (SDK 55) with expo-router for navigation. It's a family document vault with AI-powered RAG (Retrieval-Augmented Generation) search. The backend uses Supabase (PostgreSQL + Auth + Edge Functions).

## Development Environment
- **IDE**: Firebase Studio (formerly Project IDX) — a cloud-based IDE by Google
- **Nix config**: `.idx/dev.nix` defines the workspace (Node 20, JDK 21, Gradle)
- **Previews**: Firebase Studio runs the web preview on port 9002, proxied through port 9000 at `https://9000-{WEB_HOST}` where `WEB_HOST` is set by the environment
- **Android preview**: Uses emulator via `adb -s emulator-5554`

## App Config: app.json vs app.config.ts
- `app.json` contains the static Expo config (name, slug, plugins, etc.)
- `app.config.ts` is the **dynamic** config that wraps `app.json` via `...config` spread. Expo loads `app.config.ts` over `app.json` when both exist.
- **Why app.config.ts exists**: Firebase Studio proxies the web preview through a different origin (port 9000). Expo's CORS middleware (`@expo/cli CorsMiddleware`) rejects requests from origins that aren't `localhost` or explicitly allowed. The dynamic config reads `process.env.WEB_HOST` and sets `extra.router.origin` to `https://9000-{WEB_HOST}`, which the CORS middleware checks in its `allowedHosts` list. This is the only way to allow the Firebase Studio proxy origin since `app.json` doesn't support environment variable interpolation.
- **Important**: When modifying Expo config, edit `app.config.ts` (not `app.json`) to preserve the CORS fix. If you edit `app.json`, the static values will be picked up via `...config` spread, but any fields duplicated in `app.config.ts` will take precedence.

## Tech Stack
- **Framework**: Expo ~55, expo-router ~55, React Native 0.84+, React 19
- **Navigation**: expo-router (Stack + Tabs with custom tab bar)
- **Styling**: React Native `StyleSheet` — no NativeWind or Tailwind
- **Icons**: `@expo/vector-icons` (Feather icon set)
- **Gradients**: `expo-linear-gradient`
- **Safe Area**: `react-native-safe-area-context`
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions)
- **Client lib**: `src/lib/supabase.ts` (uses AsyncStorage for session persistence)
- **OCR (Web)**: `tesseract.js` — WASM-based, runs in browser, free, unlimited
- **OCR (Android/iOS)**: `react-native-mlkit-ocr` — Google ML Kit, on-device, free, unlimited
- **OCR (Server fallback)**: OCR.space API — for PDFs with compressed text, free 25K/month
- **Embeddings**: HuggingFace Inference API — `all-MiniLM-L6-v2` model, 384 dims, free
- **Vector Search**: pgvector — HNSW index on `document_chunks.embedding` column
- **LLM (RAG)**: Groq API — `llama-3.3-70b-versatile`, 30 RPM free, generates answers from document chunks

## Design Tokens
- Primary: `#2A3D66` (dark navy)
- Secondary: `#4A6491` (medium blue)
- Accent: `#D4807B` (coral/salmon)
- Background: `#F8F9FC` (light gray)
- Dark bg: `#0D1117`, Dark card: `#161B22`

## App Structure (src/app/)
```
_layout.tsx          -> Root Stack (headerShown: false) + AuthGate
index.tsx            -> Redirect to /onboarding or /home based on auth
onboarding.tsx       -> 3-slide onboarding (LinearGradient bg)
login.tsx            -> Login with email/password + Google OAuth + biometric UI
setup-family.tsx     -> First-time family vault creation
notifications.tsx    -> Notification list (expiry alerts, uploads, invites)
(tabs)/
  _layout.tsx        -> Custom tab bar (raised search btn via CustomTabBar)
  home.tsx           -> Dashboard: stats, recent docs, bell badge, useFocusEffect refresh
  search.tsx         -> RAG chat interface: AI answers + source docs (Groq/Llama)
  upload.tsx         -> Upload with client-side OCR progress bar
  family.tsx         -> Family tree + member list + add member modal
  settings.tsx       -> Profile card + settings groups + sign out
document/
  [id].tsx           -> Document viewer with action bar (share/download/edit/delete)
+html.tsx            -> Custom HTML shell for web
```

## Navigation
- `(tabs)` is a layout group — routes are `/home`, `/search`, `/upload`, `/family`, `/settings`
- Use `as any` cast with `router.push`/`replace` for non-typed routes
- `router.replace('/home' as any)` from login; `router.replace('/login' as any)` for sign out

## Backend — Supabase
- **DB**: 3-layer architecture
  - Layer 1 (Common): `public` schema — users, families, family_members, invitations, document_categories, notifications, audit_logs
  - Layer 2 (Private): Per-family isolated schemas (`family_<short_uuid>`) — documents, document_metadata, document_chunks, expiry_alerts, family_relationships
  - Layer 3 (Vector): pgvector `embedding vector(384)` on `document_chunks` with HNSW index
- **Auth**: Supabase Auth -> auto-creates `public.users` via trigger
- **RLS**: Enabled on all common tables
- **Types**: `src/lib/database.types.ts`
- **SQL migrations**: `supabase/migrations/` (applied via Supabase SQL Editor, excluded from git)
- **Family creation**: `public.create_family()` PG function creates schema + tables + indexes + admin member
- **Env vars**: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (loaded from `.env`)
- **Edge Function secrets**: `GROQ_API_KEY`, `OCR_SPACE_API_KEY`, `HF_API_TOKEN` (set via `supabase secrets set`)
- **DB schema spec**: `Files/familyvault-db-agent-prompt.md`

## Edge Functions (supabase/functions/)
- **ingest-document** — Document processing pipeline:
  1. Accepts pre-extracted OCR text from client OR falls back to server-side extraction
  2. PDF: simple text parser → OCR.space fallback for compressed/scanned PDFs
  3. Images: OCR.space Engine 2 (server-side fallback if client OCR wasn't provided)
  4. Chunks text (500 tokens, 50 overlap, paragraph-aware)
  5. Generates embeddings via HuggingFace all-MiniLM-L6-v2 (384 dims)
  6. Extracts metadata (expiry dates, passport numbers, PAN, Aadhaar, policy numbers, etc.)
  7. Stores via `complete_document_ingestion` RPC (ocr_text + chunks + embeddings + metadata)
  8. Auto-creates expiry alerts when expiry_date detected
- **rag-search** — RAG answer generation:
  1. Retrieves matching document chunks via `rag_retrieve_chunks` RPC (full-text search)
  2. Sends chunks + user query to Groq (Llama 3.3 70B)
  3. Returns AI-generated answer + source document references
- **invite-member** — Sends family invitation emails via Supabase Auth

## RAG Pipeline (end-to-end)
```
INGESTION:
  Upload → Client OCR (Tesseract/ML Kit) → Upload file + text → Edge Function
    → OCR.space fallback (if needed) → Chunk text → Embed chunks → Extract metadata
    → Store in document_chunks (with vectors) + document_metadata → Create expiry alerts

SEARCH:
  User question → rag-search Edge Function → Retrieve chunks (tsquery full-text)
    → Send chunks to Groq/Llama 3.3 → Generate answer → Return answer + source docs
```

## Key Patterns
- All screens use `SafeAreaView` with `edges={['top']}`
- Tab layout uses a custom `tabBar` prop (`CustomTabBar`) with raised Upload button
- Feather icon for biometric/fingerprint: `"aperture"` (no fingerprint in Feather set)

## Web Compatibility (important)
- **Shadow props**: React Native 0.84+ / Expo SDK 55 deprecates `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius` on web. Use `boxShadow` (CSS shorthand string) instead. Example: `boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)'`. The `elevation` prop is still used for Android shadows.
- **CORS on Firebase Studio**: Handled via `app.config.ts` `extra.router.origin` (see "App Config" section above). Do not remove this.
- **Figma designs**: Located at `/home/user/familyvault/Figma designs/` — original web designs (React + Tailwind + react-router) that were translated to React Native StyleSheet components.

## Key Libraries (src/lib/)
- **supabase.ts** — Supabase client (AsyncStorage for session persistence)
- **auth.tsx** — AuthProvider context: session, signIn, signUp, signInWithGoogle, signOut
- **family-context.tsx** — FamilyProvider: currentFamily, members, membership, needsFamily
- **api.ts** — All Supabase queries: documents, search, upload, notifications, RAG search, categories, invitations
- **ocr.ts** — Platform-split OCR: Tesseract.js (web) / ML Kit (Android/iOS), with progress callback
- **database.types.ts** — Auto-generated Supabase types
- **drawer-context.tsx** — Profile drawer state

## Deployed Services
- **Supabase Project (DEV)**: `tkqsfoppwlyupentuixy.supabase.co`
- **Supabase Project (PROD)**: `yrcmdixqgvmhqxejvlor.supabase.co`
- **Edge Functions**: `ingest-document`, `rag-search`, `invite-member`
- **Secrets configured**: `GROQ_API_KEY`, `OCR_SPACE_API_KEY`

## Known Issues & Past Fixes
1. **Firebase Studio CORS error** (fixed): Expo dev server's `CorsMiddleware` rejected requests from the Firebase Studio proxy origin. Fixed by creating `app.config.ts` that dynamically sets `extra.router.origin` to the proxy URL using `WEB_HOST` env var.
2. **"shadow* style props are deprecated" error** (fixed): Replaced all `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` with `boxShadow` CSS shorthand across 8 files (16 occurrences). The `elevation` property was kept for Android.
3. **libglib-2.0.so.0 missing** (harmless): React Native DevTools fails to install in the Firebase Studio environment. This is a missing system library in the Nix sandbox — it does not affect the web preview or app functionality.
4. **Edge Function CORS** (fixed): Added `corsHeaders` + OPTIONS preflight handler to all Edge Functions.
5. **PDF text extraction garbage** (fixed): Simple BT/ET parser couldn't read compressed PDFs. Added OCR.space API as server-side fallback.
6. **HuggingFace embedding 404** (partial): HF Inference API changed endpoints. Added fallback to `/models/` endpoint. Embeddings may still fail — text search works without them.
7. **Empty vector insert crash** (fixed): `vector must have at least 1 dimension` when HF returns empty arrays. RPC now skips null/empty embeddings gracefully.
8. **Document list stale after delete** (fixed): Replaced `useEffect` with `useFocusEffect` in home.tsx to re-fetch on screen focus.
9. **Family schema missing columns** (fixed): Existing family schemas created before migration 010 lacked `search_vector`, `ocr_text`, `updated_at` columns. Fixed with manual ALTER TABLE.
