-- Msaada — Supabase schema
-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE).
--
-- Msaada keeps its primary data in its own Prisma database. Supabase adds:
--   1. a demo `todos` table (Supabase quick-start shape) for auth/RLS testing
--   2. a durable cloud mirror of public community reports (see
--      src/app/api/community-reports/route.ts) so anonymous reports survive
--      ephemeral/serverless deploys of the SQLite-backed app.
--   3. a cloud mirror of offline encounter drafts queued on CHV devices (see
--      src/lib/sync/draft-queue.ts) so nothing is lost when the network drops.

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
-- Written by the Next.js server (publishable key, anon role) right after the
-- report is accepted into the primary store. Privacy posture matches the
-- app: description is already PII-scrubbed server-side, no reporter identity
-- is stored, and anonymous visitors can insert but never read back — only
-- authenticated Msaada staff (CHV/supervisor/admin) can select.
create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique,
  county text,
  description text not null,
  classification text check (classification in ('routine','needs_followup','needs_facility_referral')),
  urgency text check (urgency in ('low','medium','high')),
  workflow_class text,
  policy_version text,
  created_at timestamptz not null default now()
);

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
-- 3. Encounter drafts — offline-first sync queue (issue #18)
-- ---------------------------------------------------------------------------
-- Written by the CHV's browser (src/lib/sync/draft-queue.ts): every encounter
-- observation is queued in localStorage before the network attempt and upserted
-- here on mount / window "online". `client_uuid` is the client-generated
-- idempotency key, so retried flushes never duplicate rows. RLS scopes every
-- row to its owner (auth.uid() = user_id). `payload` is structured metadata
-- only (encounter/county/ward) — raw observation free-text is never stored,
-- matching the app-wide de-identification rule.
create table if not exists public.encounter_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_uuid text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  synced_at timestamptz
);

alter table public.encounter_drafts enable row level security;

drop policy if exists "Users can read their own encounter drafts" on public.encounter_drafts;
drop policy if exists "Users can create their own encounter drafts" on public.encounter_drafts;
drop policy if exists "Users can update their own encounter drafts" on public.encounter_drafts;

create policy "Users can read their own encounter drafts"
  on public.encounter_drafts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own encounter drafts"
  on public.encounter_drafts for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own encounter drafts"
  on public.encounter_drafts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

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
