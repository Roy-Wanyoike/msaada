-- Msaada — Supabase schema
-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE).
--
-- Msaada keeps its primary data in its own Prisma database. Supabase adds:
--   1. a demo `todos` table (Supabase quick-start shape) for auth/RLS testing
--   2. a durable cloud mirror of public community reports (see
--      src/app/api/community-reports/route.ts) so anonymous reports survive
--      ephemeral/serverless deploys of the SQLite-backed app.
--   3. a cloud mirror of offline encounter drafts queued on CHV devices,
--      written server-side by POST /api/encounters/drafts (issue #45) so
--      nothing is lost when the network drops.

-- ---------------------------------------------------------------------------
-- 1. Todos (quick-start demo table)
-- ---------------------------------------------------------------------------
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  is_complete boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.todos enable row level security;

drop policy if exists "Users can read their own todos" on public.todos;
drop policy if exists "Users can create their own todos" on public.todos;
drop policy if exists "Users can update their own todos" on public.todos;
drop policy if exists "Users can delete their own todos" on public.todos;

create policy "Users can read their own todos"
  on public.todos for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own todos"
  on public.todos for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own todos"
  on public.todos for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own todos"
  on public.todos for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2. Community reports — durable cloud mirror
-- ---------------------------------------------------------------------------
-- Written SERVER-SIDE by the Next.js POST /api/community-reports handler
-- (src/lib/supabase-mirror.ts) right after the report is accepted into the
-- primary store, using the publishable (anon) key. Fire-and-forget: a mirror
-- failure never fails the 201 and never touches the primary SQLite store.
-- Privacy posture matches the app: description is already PII-scrubbed
-- server-side, no reporter identity is stored (no name, no contact, no IP —
-- coarse location + category + lifecycle status + report code only), and
-- anonymous visitors can insert but never read back — only authenticated
-- Msaada staff (CHV/supervisor/admin) can select.
--
-- Columns (issue #45 — matches the implemented writer exactly):
--   report_code     the app's stable MSD-RPT-XXXX public identifier
--   county / ward   coarse location, as accepted by the POST validation
--   category        mental_health | maternal | child_health | social_support | other
--   status          report lifecycle snapshot at insert time ("received")
--   description     the ALREADY-scrubbed text (the scrubbed text IS the fact)
--   workflow_class / policy_version  null at insert; the interpretation
--                   happens later on the intake path
--   idempotency_key unique — replays of the same report are ignored
--                   (Prefer: resolution=ignore-duplicates).
-- MIGRATION (existing projects): re-run this file — the ALTERs below add the
-- newer columns to a pre-existing table idempotently.
create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique,
  county text,
  ward text,
  category text,
  status text,
  description text not null,
  workflow_class text,
  policy_version text,
  created_at timestamptz not null default now()
);

-- Idempotent upgrades for tables created by an older schema revision.
alter table public.community_reports add column if not exists ward text;
alter table public.community_reports add column if not exists category text;
alter table public.community_reports add column if not exists status text;
alter table public.community_reports add column if not exists workflow_class text;
alter table public.community_reports add column if not exists policy_version text;
alter table public.community_reports add column if not exists report_code text;
-- The old revision reserved classification/urgency columns that no writer
-- ever filled (the mirror writer did not exist yet) — drop them so the
-- table matches the implemented contract exactly.
alter table public.community_reports drop column if exists classification;
alter table public.community_reports drop column if exists urgency;
create index if not exists community_reports_code_idx
  on public.community_reports (report_code);

alter table public.community_reports enable row level security;

drop policy if exists "Public can submit reports" on public.community_reports;
drop policy if exists "Staff can read reports" on public.community_reports;

create policy "Public can submit reports"
  on public.community_reports for insert to anon
  with check (true);

create policy "Staff can read reports"
  on public.community_reports for select to authenticated
  using (true);

create index if not exists community_reports_county_idx
  on public.community_reports (county, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Encounter drafts — offline sync queue (issues #18 + #45)
-- ---------------------------------------------------------------------------
-- Written SERVER-SIDE by POST /api/encounters/drafts
-- (src/app/api/encounters/drafts/route.ts): the CHV's browser queues drafts
-- in localStorage (src/lib/sync/draft-queue.ts) and flushes them to the
-- first-party, cookie-authed endpoint on mount / window "online". The server
-- authenticates the CHV with Msaada's own session, then inserts here with
-- the publishable (anon) key.
--
-- DESIGN DECISION (issue #45 — why anon INSERT instead of Supabase-Auth
-- user-scoped RLS): the old schema scoped every row to auth.uid(), but NO
-- Msaada flow ever creates a Supabase Auth session, so the sync was
-- unreachable end-to-end (drafts queued forever, silently). There is no
-- Supabase user to own the rows — the first-party server is the writer.
-- Anon INSERT is acceptable here because:
--   * payloads are STRUCTURED METADATA ONLY (encounterId/encounterCode/
--     county/ward — no free text, no names, no contact details; enforced by
--     the endpoint, which persists exactly those fields);
--   * anon can INSERT but never SELECT/UPDATE/DELETE (no such policies), so
--     the public publishable key cannot read or mutate existing rows;
--   * client_uuid is UNIQUE and inserts use Prefer:
--     resolution=ignore-duplicates → idempotent replays, never duplicates;
--   * the table is a queue mirror, not a source of truth — the primary
--     record lives in the app's own database.
-- MIGRATION (existing projects): user_id referenced auth.users; no rows were
-- ever written (the old sync was unreachable), so dropping it loses nothing.
create table if not exists public.encounter_drafts (
  id uuid primary key default gen_random_uuid(),
  client_uuid text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  synced_at timestamptz
);

-- Idempotent upgrades for tables created by an older schema revision.
alter table public.encounter_drafts drop column if exists user_id;
alter table public.encounter_drafts add column if not exists payload jsonb;
alter table public.encounter_drafts add column if not exists synced_at timestamptz;

alter table public.encounter_drafts enable row level security;

drop policy if exists "Users can read their own encounter drafts" on public.encounter_drafts;
drop policy if exists "Users can create their own encounter drafts" on public.encounter_drafts;
drop policy if exists "Users can update their own encounter drafts" on public.encounter_drafts;
drop policy if exists "Server can enqueue encounter drafts" on public.encounter_drafts;
drop policy if exists "Staff can read encounter drafts" on public.encounter_drafts;

-- The first-party server writes with the publishable (anon) key. Metadata-
-- only payloads by construction (see the design note above).
create policy "Server can enqueue encounter drafts"
  on public.encounter_drafts for insert to anon
  with check (true);

-- Staff (authenticated Msaada roles) may inspect the queue for support/
-- reconciliation. Anon still has NO select/update/delete.
create policy "Staff can read encounter drafts"
  on public.encounter_drafts for select to authenticated
  using (true);

create index if not exists encounter_drafts_synced_idx
  on public.encounter_drafts (synced_at);

-- ---------------------------------------------------------------------------
-- 4. Authentication schema (mirrors the Prisma models in prisma/schema.prisma)
-- ---------------------------------------------------------------------------
-- The app currently signs its own HMAC cookie sessions against the primary
-- Prisma database (see src/lib/auth.ts). These tables provision the SAME
-- auth layer in Supabase so the hosted database has a complete schema for
-- authentication, ready for the moment auth moves to Supabase Auth:
--
--   auth_sessions          one row per issued session — stores ONLY the
--                          SHA-256 hash of the opaque token (never the raw
--                          token), so sessions are revocable server-side.
--   auth_events            append-only audit trail of login/logout attempts
--                          (never passwords, never tokens, never IPs).
--   password_reset_tokens  hashed, single-use, expiring reset tokens.
--
-- Security posture: RLS is ENABLED and NO anon/authenticated policies are
-- created — clients (anon or authenticated keys) are denied everything.
-- Only the server, using the service-role key (which bypasses RLS), may
-- read/write these tables. Session hashes and auth audit rows must never
-- be client-readable.
create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists auth_sessions_user_idx
  on public.auth_sessions (user_id, revoked_at);
create index if not exists auth_sessions_expiry_idx
  on public.auth_sessions (expires_at);

create table if not exists public.auth_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event text not null check (event in ('login_succeeded','login_failed','logout','session_rejected')),
  user_id uuid references auth.users(id) on delete set null,
  email_attempt text,
  detail text,
  user_agent text
);

create index if not exists auth_events_user_idx
  on public.auth_events (user_id, created_at desc);
create index if not exists auth_events_event_idx
  on public.auth_events (event, created_at desc);
create index if not exists auth_events_email_idx
  on public.auth_events (email_attempt);

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_idx
  on public.password_reset_tokens (user_id);

alter table public.auth_sessions enable row level security;
alter table public.auth_events enable row level security;
alter table public.password_reset_tokens enable row level security;

-- Deliberately NO policies: deny-all for anon + authenticated (see the
-- security note above). The service-role server path bypasses RLS.
