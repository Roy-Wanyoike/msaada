# 18 — Wire Supabase into offline-first encounter draft sync

**Labels:** `feature`, `supabase`

## Problem
Supabase helpers exist (`src/utils/supabase/*`) but no feature uses them.
The README's headline production target is **offline-first sync** for CHV
encounters. Deliver the hackathon-grade slice: durable draft sync of
encounter observations to Supabase when signed in, with a local queue when
offline or unauthenticated.

## Scope
1. `supabase/schema.sql`: add `encounter_drafts` table —
   `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`,
   `client_uuid text not null unique`, `payload jsonb not null`,
   `created_at timestamptz default now()`, `synced_at timestamptz`.
   RLS enabled: select/insert/update **own rows only**
   (`(select auth.uid()) = user_id`). Keep the existing `todos` demo table
   section intact.
2. `src/lib/sync/draft-queue.ts` — framework-neutral queue:
   - `queueDraft(draft)`: append to `localStorage` key `msaada.draft-queue.v1`
     (array of `{ clientUuid, payload, queuedAt }`)
   - `flushDrafts()`: if `navigator.onLine` and Supabase configured and a
     session exists (`supabase.auth.getSession()`), upsert each draft
     (on conflict `client_uuid` do nothing) then clear flushed entries;
     returns `{ flushed, remaining }`
   - Never store raw PII in the queue beyond what the form already holds;
     never store tokens.
3. Hook into the encounter/observation submission UI (where the CHV submits
   `/api/triage`): queue the draft before submit; on `fetch` failure or
   offline, the draft stays queued with a visible "saved offline — will sync"
   note; call `flushDrafts()` on mount + `online` event. UI copy in English.
4. `/status`-style honest degradation: if Supabase is not configured the
   queue simply remains local — no errors thrown, no crashes.

## Acceptance criteria
- [ ] `schema.sql` updated; running it twice is idempotent
      (`create table if not exists` / `drop policy if exists` then create)
- [ ] With Supabase unset: submission flow unchanged, drafts persist locally
- [ ] With Supabase set + signed in: queued draft lands in `encounter_drafts`
- [ ] No secrets in code; `bun run build` clean

## Notes
- Commit message: `feat(sync): offline-first encounter draft sync via Supabase (#18)`
