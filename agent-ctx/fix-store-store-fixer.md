# Task ID: fix-store
# Agent: store-fixer

## Scope
Data-access bugfixes flagged by audit-1-codebase (C3 — `fallbackUsed` lost on
retrieval) and audit-7-pii-fu / audit-1 (county-scope leak in the dashboard
audit strip). Plus a dead nested ternary cleanup in `insertTriageRecord`.

## Files changed
1. `prisma/schema.prisma` — added `fallbackUsed Boolean @default(false)` to the
   `TriageRecord` model.
2. `src/lib/triage-store.ts`:
   - `insertTriageRecord`: writes `fallbackUsed` into the create payload.
   - Fixed dead nested ternary
     `chpNextAction: isCrisis ? null : (isCrisis ? null : output.chp_next_action)`
     → `chpNextAction: isCrisis ? null : output.chp_next_action`.
   - `toDTO`: dropped the `fallbackUsed: boolean` parameter; now reads
     `row.fallbackUsed` directly. Added `fallbackUsed: boolean` to the row
     type. Returns `fallbackUsed: row.fallbackUsed`.
   - Updated both call sites (`insertTriageRecord` return + `getMyRecords`
     map) to drop the second argument.
   - `getRecentAudit(limit, county?)`: added optional `county` parameter;
     `where: county ? { county } : undefined`.
3. `src/app/api/dashboard/route.ts` — `getRecentAudit(8, scopeCounty ?? undefined)`
   so the audit strip is county-scoped on the `?scope=mine` RBAC path.

## Verification
- `bun run db:push` → "Your database is now in sync with your Prisma schema"
  (15ms).
- `bun run db:generate` → Prisma Client v6.19.2 generated.
- `bun run lint` → PASS (no errors, no warnings).
- Dev log shows clean compile + 200s on `/` and `/api/auth/me`.

## Why these bugs mattered
- C3: the DTO contract declared `fallbackUsed` authoritative, but the column
  was missing → `getMyRecords` hardcoded `false` → the amber "Caution
  fallback applied" banner in `TriageResultCard` never showed on revisited
  records, even when the original triage used the spec fallback. Now it
  persists + reads correctly.
- Audit strip leak: `getRecentAudit` didn't accept a county, so on
  `?scope=mine` the dashboard rendered audit entries from ALL counties
  (RBAC leak). Now it's filtered to the CHV's county.
- Dead ternary: the inner `isCrisis ?` could never be reached because the
  outer `isCrisis` already returned `null`. Pure cleanup — behavior
  unchanged, but the linter/editor no longer shows a tautology warning.

## Hand-off
No remaining work in this task ID. Subsequent auditors / fixers can verify
the caution banner shows by:
1. POSTing `/api/seed` to get synthetic transcripts (one triggers the
   fallback path).
2. Logging in as the CHV and visiting `/report/mine` — `TriageResultCard`
   should render the amber "Caution fallback applied" banner for the
   fallback record.
3. Loading `/dashboard?scope=mine` and confirming the AuditStrip only shows
   entries from the logged-in CHV's county.
