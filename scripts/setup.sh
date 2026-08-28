#!/usr/bin/env bash
#
# FamilyVault — cloud environment bootstrap.
#
# Brings a fresh machine (cloud VM, CI runner, new clone) to the point
# where `npm run build` and `npm run web` both work. Safe to re-run.
#
#   bash scripts/setup.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m FAIL\033[0m %s\n' "$1" >&2; exit 1; }

# ─── 1. Runtime ─────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || fail "node not found. Install Node.js 22.x."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
info "node $(node -v), npm $(npm -v)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node $NODE_MAJOR is too old. This project needs Node 20+ (22.x recommended, see package.json engines)."
elif [ "$NODE_MAJOR" -ne 22 ]; then
  warn "Node $NODE_MAJOR detected; builds are verified on 22.x."
fi

# ─── 2. Dependencies ────────────────────────────────────────────
# `npm ci` is deliberate: it installs exactly package-lock.json and
# fails loudly if the lockfile and package.json have drifted apart.
info "Installing dependencies (npm ci)…"
npm ci --no-audit --no-fund --no-progress

# ─── 3. Environment file ────────────────────────────────────────
if [ -f .env ]; then
  info ".env already present — leaving it untouched."
else
  cp .env.example .env
  warn "Created .env from .env.example. Fill in the two EXPO_PUBLIC_* values before building."
fi

# ─── 4. Report which client vars are actually set ───────────────
# EXPO_PUBLIC_* are inlined at BUILD time. A build with them missing
# succeeds but produces an app that cannot reach Supabase at all —
# so surface it here rather than letting it fail silently in a browser.
missing=0
for var in EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY; do
  # Prefer a real environment value (how Vercel supplies them); fall
  # back to a non-placeholder line in .env (how local dev supplies them).
  value="${!var-}"
  if [ -z "$value" ] && [ -f .env ]; then
    value="$(grep -E "^${var}=" .env | tail -1 | cut -d= -f2- || true)"
  fi
  case "$value" in
    ''|*your-project-id*|*your-anon-key*)
      warn "$var is not set"
      missing=$((missing + 1)) ;;
    *)
      info "$var is set" ;;
  esac
done

echo
if [ "$missing" -gt 0 ]; then
  warn "Setup finished, but $missing Supabase variable(s) still need values."
  warn "Local:  edit .env      Vercel:  Project Settings > Environment Variables"
else
  info "Setup complete. Next:  npm run web   (dev)   |   npm run build   (static export to dist/)"
fi
