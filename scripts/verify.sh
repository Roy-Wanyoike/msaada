#!/usr/bin/env bash
# Msaada one-command quality gate — operating model §43–44.
#
#   npm run verify          static gates: prisma generate → tsc --noEmit → eslint → build
#   npm run verify:smoke    static gates + boots the standalone server on a throwaway
#                           /tmp SQLite DB and probes /api/health, demo login, /presentation
#
# Exits non-zero on the first failing gate. The smoke run never touches the dev DB,
# never calls Qwen, and prints no secrets (its session secret is a throwaway literal).

set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

MODE="static"
[ "${1:-}" = "--smoke" ] && MODE="smoke"

RUNNER="npm"
command -v bun >/dev/null 2>&1 && RUNNER="bun"

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
pass() { printf '\033[1;32m✔ %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m✘ %s\033[0m\n' "$1"; exit 1; }

step "verify ($MODE) — runner: $RUNNER"

# 1 ─ Prisma client (needed by tsc; idempotent)
step "1/4 prisma generate"
$RUNNER run db:generate >/dev/null 2>&1 || npx prisma generate >/dev/null 2>&1 \
  || fail "prisma generate failed"
pass "prisma client generated"

# 2 ─ Types
step "2/4 tsc --noEmit"
$RUNNER exec tsc --noEmit >/dev/null 2>&1 || npx tsc --noEmit >/dev/null 2>&1 \
  || fail "typecheck failed"
pass "typecheck clean"

# 3 ─ Lint
step "3/4 eslint ."
$RUNNER run lint --silent >/dev/null 2>&1 || npx eslint . >/dev/null 2>&1 \
  || fail "eslint failed"
pass "eslint clean"

# 4 ─ Build (canonical script; also assembles the standalone output used by --smoke)
step "4/4 next build"
$RUNNER run build >/dev/null 2>&1 || npm run build >/dev/null 2>&1 \
  || fail "build failed"
pass "build clean"

if [ "$MODE" = "static" ]; then
  pass "repository healthy (static gates)"
  exit 0
fi

# ───────────────────────── smoke gates ─────────────────────────
PORT=3311
TMPDB="/tmp/msaada-verify-smoke-$$.db"
SECRET="verify-smoke-throwaway-secret-0123456789abcdef0123456789abcdef"
BASE="http://localhost:$PORT"
COOKIE=$(mktemp)
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" >/dev/null 2>&1 || true
  rm -f "$COOKIE" "$TMPDB"
}
trap cleanup EXIT

step "5/7 boot standalone server (throwaway DB: $TMPDB)"
rm -f "$TMPDB"
NODE_ENV=production PORT=$PORT DATABASE_URL="file:$TMPDB" \
  MSAADA_SESSION_SECRET="$SECRET" \
  node .next/standalone/server.js >/tmp/msaada-verify-server.log 2>&1 &
SERVER_PID=$!

for i in $(seq 1 30); do
  curl -sf -m 2 "$BASE/api/health" >/dev/null 2>&1 && break
  kill -0 "$SERVER_PID" 2>/dev/null || { tail -5 /tmp/msaada-verify-server.log; fail "server died during boot"; }
  [ "$i" = 30 ] && fail "server never became healthy"
  sleep 1
done
pass "server healthy on :$PORT"

step "6/7 probe /api/health + demo login + /presentation"
HEALTH=$(curl -sf -m 10 "$BASE/api/health") || fail "/api/health unreachable"
echo "$HEALTH" | rg -q '"ok"' || echo "$HEALTH" | rg -qi 'ok' || fail "/api/health not ok: $HEALTH"
pass "/api/health ok"

curl -sf -m 10 -c "$COOKIE" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@msaada.health","password":"msaada123"}' >/dev/null \
  || fail "demo CHV login failed"
[ -s "$COOKIE" ] || fail "login set no session cookie"
pass "demo CHV login ok (session cookie issued)"

curl -sf -m 10 -b "$COOKIE" "$BASE/presentation" | rg -qi 'Msaada' \
  || fail "/presentation did not render"
pass "/presentation renders"

step "7/7 revoked-cookie replay rejected (revocable sessions)"
SESSION_COOKIE=$(rg -o 'msaada_session\s+(\S+)' "$COOKIE" | awk '{print $2}' | head -1)
[ -n "$SESSION_COOKIE" ] || fail "could not read session cookie from jar"
curl -sf -m 10 -b "$COOKIE" -X POST "$BASE/api/auth/logout" >/dev/null || true
REPLAY=$(curl -s -m 10 -o /dev/null -w '%{http_code}' \
  -H "Cookie: msaada_session=$SESSION_COOKIE" "$BASE/api/records/mine")
[ "$REPLAY" = "401" ] || fail "revoked cookie replay returned $REPLAY (expected 401)"
pass "revoked cookie replay → 401"

pass "repository healthy (static + smoke gates)"
