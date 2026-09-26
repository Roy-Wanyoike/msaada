# 17 — `/api/health` endpoint + `/status` demo page (Qwen / Supabase / DB)

**Labels:** `feature`, `devops`

## Problem
Judges and ops have no quick way to see whether the deployed app's
dependencies (database, Qwen inference, Supabase project) are reachable and
configured. The demo needs a live status surface.

## Scope
1. `GET /api/health` — public, cache: no-store. Responds within timeout
   guards (~3s each, run the three probes **in parallel**):
   - `database`: Prisma `SELECT 1` → `ok | error`
   - `qwen`: config check (`QWEN_API_KEY` present) + optional cheap liveness —
     do NOT burn tokens per request; if key missing → `not_configured`
   - `supabase`: `NEXT_PUBLIC_SUPABASE_URL` present → probe
     `${url}/auth/v1/health` (fetch, 3s timeout) → `ok | error | not_configured`
   - Payload: `{ status: "ok" | "degraded", checks: {...}, timestamp, version }`
   - **Never** echo secrets, keys, or connection strings. Status words only.
   - Absent config is `"not_configured"`, NOT a 500 — deploys without
     Supabase must still report `ok/degraded`.
2. `/status` page — small server component that calls the internal checks
   directly (not via HTTP), renders three status cards (green/amber/red),
   auto-refreshes via `router.refresh()` on an interval, links back to `/`.
   Match the existing shadcn/ui + Tailwind design language.

## Acceptance criteria
- [ ] `curl /api/health` returns 200 with per-check statuses (no secrets)
- [ ] With Supabase env unset: overall `degraded` (not 500), supabase=`not_configured`
- [ ] `/status` renders with correct statuses; `bun run build` clean
- [ ] Smoke test gains a `/api/health` check

## Notes
- Commit message: `feat(health): /api/health probes + /status page (#17)`
