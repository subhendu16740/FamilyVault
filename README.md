# AskLocker

An AI-powered family document vault built with React Native. AskLocker helps families organize, store, and instantly retrieve important documents using natural language search.

## Vision

Every family manages dozens of critical documents — passports, insurance policies, property deeds, medical records, tax filings. These documents are scattered across drawers, folders, email attachments, and phone galleries. When you need one urgently, finding it becomes stressful and time-consuming.

AskLocker brings all your family's important documents into one shared vault. Upload a document, and the app automatically extracts key details — names, dates, policy numbers, expiry dates. Need something? Just ask: *"Show me Dad's passport"* or *"When does Mom's health insurance expire?"* — and get instant answers powered by AI.

## Privacy, plainly

Documents are not end-to-end encrypted. They travel over https and are stored on Supabase's encrypted disks, and in the app only a family's members can open its documents. But the app's servers read each document's text to search it, the people who run AskLocker can technically open stored documents, and parts of the text go to outside services: HuggingFace (search data), Groq (answers) and OCR.space (scanned PDFs, photos from Gmail). Settings › Privacy in the app says the same.

## Key Features

### Implemented

- **Family Vault Creation** — Create a family vault and invite family members to it
- **Role-Based Access** — Only admins add and remove members and change roles; viewers have read access
- **Member Management** — Add a member by the email they sign in with (no invitations or requests to join), promote to admin, remove members; anyone can switch between their families or leave one
- **Sign-in** — Google, then fingerprint sign-in (a passkey) on the web; test builds also take an email and password
- **Home Dashboard** — At-a-glance stats (documents, members, categories), recent documents, quick actions
- **Document Viewer** — View document details with metadata, category, and owner info
- **Search Interface** — Category-based browsing and keyword search across documents
- **Saved Chats** — Save chat on Ask keeps a conversation; the clock at the top right lists them to carry on or delete. Nobody else in the family can see them, and they go if you leave it
- **Upload Flow** — Multi-step upload with source selection, metadata tagging, and owner assignment
- **Import from Gmail** ★ (web) — Connect your own Gmail; AskLocker lists the attachments that look like documents, and imports the ones you tick. What it finds is shown to you, not your family; disconnecting makes it forget
- **Menu Drawer** — Slides in from the left from the name button on Home: Home, Manage Family, Reminders ★ and Settings, with Sign Out
- **Reminders** ★ — Every document with an expiry date, soonest first. ★ Family Plus marks what the coming paid plan will add (reminders 90, 30 and 7 days ahead)
- **Settings** — Profile (name and phone), Security (password, sign out everywhere), Notifications on/off, Storage (each family's use of its free 1 GB, and what you added; more space ★), Privacy, Help & FAQ with feedback, and About (version and release date)
- **One Top Bar Everywhere** — A back arrow at the top left of every screen, with the title beside it, that works even after a refresh; one compact type and size scale (`src/constants/design.ts`) across the app
- **23 Document Categories** — Pre-configured categories including Passport, Driving License, Health Insurance, Property Deed, Tax Return, Birth Certificate, and more
- **In-App Confirmation Dialogs** — Custom modal dialogs for destructive actions
- **Onboarding Flow** — 3-slide introduction explaining the app's value

### Planned

- **Document Upload to Cloud** — Upload files to Supabase Storage with per-family isolation
- **OCR Text Extraction** — Automatically extract text from scanned documents and photos
- **AI Metadata Detection** — Auto-detect passport numbers, expiry dates, policy numbers from document content
- **RAG-Powered Search** — Natural language search using document embeddings and vector similarity
- **Alias Resolution** — Search using family nicknames ("Dad", "Mom") mapped to actual members
- **Expiry Alerts** — Automatic notifications 90, 30, and 7 days before document expiration
- **Document Sharing & Export** — Share documents securely with family members or export as PDF
- **Offline Support** — Access recently viewed documents without internet
- **Biometric Authentication** — Fingerprint and Face ID unlock
- **Dark Mode** — Full dark theme support
- **Audit Logs** — Track who uploaded, viewed, or modified documents
- **Voice Search** — Search your vault using voice commands

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Expo SDK 55 + expo-router |
| **Language** | TypeScript (React Native) |
| **Backend** | Supabase (PostgreSQL + Auth + Storage) |
| **Navigation** | expo-router (Stack + Tabs) |
| **Styling** | React Native StyleSheet |
| **Icons** | @expo/vector-icons (Feather) |
| **Gradients** | expo-linear-gradient |

## Architecture

### Three-Layer Database Design

AskLocker uses a unique three-layer database architecture that provides complete data isolation between families:

**Layer 1 — Common Database** (Public PostgreSQL Schema)
Shared tables for user accounts, family records, memberships, invitations, document categories, notifications, and audit logs. Protected by Row-Level Security (RLS) policies ensuring users only access their own data.

**Layer 2 — Private Database** (Per-Family PostgreSQL Schemas)
Each family gets its own isolated database schema (`family_{uuid}`). Contains documents, extracted metadata, text chunks, expiry alerts, and family relationships. No cross-family data leakage is possible.

**Layer 3 — Vector Database** (Per-Family Namespace)
Each family gets an isolated namespace for document embeddings. Enables semantic search with metadata filtering — search by content meaning, not just keywords.

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (`npx expo`)
- A Supabase project

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/subhendu16740/FamilyVault.git
   cd AskLocker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your Supabase project URL and anon key (found in your Supabase dashboard under Settings > API).

4. Set up the database:
   Run the SQL migrations in order (`supabase/migrations/001_*.sql` through `009_*.sql`) in your Supabase SQL Editor.

5. Start the development server:
   ```bash
   npx expo start
   ```

6. Open the app on web, iOS simulator, or Android emulator using the Expo dev tools.

## Project Structure

```
src/
├── app/
│   ├── _layout.tsx           # Root layout with auth gate
│   ├── index.tsx             # Entry point / redirect
│   ├── onboarding.tsx        # Onboarding slides
│   ├── login.tsx             # Authentication screen
│   ├── setup-family.tsx      # First-time family creation
│   ├── family.tsx            # Family member management
│   ├── settings.tsx          # User settings
│   ├── (tabs)/
│   │   ├── _layout.tsx       # Tab bar with custom styling
│   │   ├── home.tsx          # Dashboard
│   │   ├── search.tsx        # Document search
│   │   └── upload.tsx        # Document upload flow
│   └── document/
│       └── [id].tsx          # Document viewer
├── components/
│   └── ProfileDrawer.tsx     # Slide-out profile menu
└── lib/
    ├── api.ts                # Supabase query layer
    ├── auth.tsx              # Auth context provider
    ├── family-context.tsx    # Family data context
    ├── drawer-context.tsx    # Drawer state context
    ├── supabase.ts           # Supabase client init
    └── database.types.ts     # TypeScript DB types

supabase/
└── migrations/               # SQL migrations (001-009)
```

## License

This project is private and not licensed for public use.
