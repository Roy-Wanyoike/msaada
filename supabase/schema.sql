-- Msaada — Supabase schema
-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE).
--
-- Msaada keeps its primary data in its own Prisma database. Supabase adds:
--   1. a demo `todos` table (Supabase quick-start shape) for auth/RLS testing
--   2. a durable cloud mirror of public community reports (see
--      src/app/api/community-reports/route.ts) so anonymous reports survive
--      ephemeral/serverless deploys of the SQLite-backed app.

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
