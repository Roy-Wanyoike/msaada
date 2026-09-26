# Msaada

> *Msaada* — "help" / "assistance" in Swahili.

**Msaada is an AI-powered, offline-first Community Health Intelligence Platform designed to strengthen the connection between Community Health Volunteers (CHVs), households, health facilities, county health teams, and the Ministry of Health.**

---

## Problem

Msaada addresses a major gap in community healthcare: CHVs are already present in communities and often observe important health and social signals, but information can remain fragmented across notebooks, memory, phone calls, WhatsApp messages, and disconnected reporting systems. This makes it difficult to identify people who need follow-up, track referrals, understand community-level trends, and give health managers timely intelligence.

## Proposed Solution

Msaada creates a complete digital workflow:

**Institution → Community Health Officer → Supervisor → CHV → Household → Person → Encounter → Referral → Follow-up → Community Intelligence.**

---

## Key Features

### 1. Institutional onboarding and authentication
- Ministry of Health and county health-team accounts.
- County administrators onboard supervisors and CHVs.
- Role-based and geographic access controls.
- CHV assignment to Community Health Units and specific communities.
- Device registration and secure authentication.
- Full audit trail of sensitive actions.

### 2. CHV field application
- Simple Android application designed for field environments (production target — the hackathon MVP is a Next.js web app).
- Assigned household and patient lists.
- Household profiles and previous encounters.
- Offline-first operation for areas with poor connectivity.
- Secure synchronization when connectivity returns.
- Tasks, pending follow-ups, referrals, and urgent actions.

### 3. Household and patient traceability
- Structured household records.
- Individual community-member profiles.
- Address, village/community, landmarks, contact information, and optional location information.
- Household-to-person relationships.
- Longitudinal encounter history.
- Duplicate detection and human-confirmed identity matching.

### 4. Voice-first data collection
CHVs can record observations naturally in **Kiswahili, Sheng, English, or code-switched language** instead of completing lengthy clinical forms. Msaada converts voice or text into structured observations while preserving the original source information for auditability.

### 5. AI-assisted information extraction
AI helps identify relevant signals such as changes in wellbeing, sleep, social functioning, family circumstances, environmental stressors, and other configured community-health indicators. The AI does **not diagnose patients**. It structures information and assists the CHV with the next operational step.

### 6. Deterministic safety and routing engine
Critical safety decisions are separated from the AI model. The system applies versioned, auditable rules to determine whether an encounter requires routine monitoring, follow-up, or urgent referral/escalation. **The AI cannot override the configured safety rules.**

### 7. Referral management
- Create referrals from encounters.
- Route people toward configured health services.
- Track referral status (created → sent → acknowledged → in_progress → completed/declined/cancelled/expired).
- Record acknowledgement and completion.
- Identify referrals that have not been completed.
- Support supervisor intervention when follow-up is overdue.

### 8. Follow-up management
CHVs and supervisors can see who needs follow-up, why it's required, when it's due, who is responsible, whether the person was successfully reached, and what happened during the follow-up.

### 9. Community health intelligence
County and authorized Ministry teams receive aggregated intelligence rather than unrestricted patient-level information. Dashboards show community reporting coverage, encounter volumes, follow-up rates, referral activity and completion, geographic distribution, changes over time, emerging areas, and CHV/CHU activity.

### 10. Early-warning signals
Msaada can identify unusual changes in reported community signals — presented as **signals requiring human investigation**, not as automatic diagnoses or claims about population prevalence.

### 11. Supervisor command center
Supervisors can monitor active CHVs, household coverage, pending encounters, follow-ups, referral status, data-quality issues, synchronization problems, and areas with emerging signals.

### 12. Offline synchronization (production target)
A CHV can open assigned households while offline, capture an encounter, record voice or structured information, store securely on device, continue working without connectivity, and synchronize automatically when connection returns. The sync layer handles retries, duplicate prevention, interrupted transfers, and conflict resolution.

### 13. Privacy and security
- Role-based access, geographic authorization, encryption, secure device storage, audit logging.
- Controlled patient-location visibility.
- No unnecessary patient information in AI prompts or system logs.
- Aggregation and de-identification for population dashboards.
- Configurable retention and access policies.

### 14. AI transparency and evaluation
Msaada records which AI model/version generated a structured interpretation and keeps the source observation separate from the AI interpretation. The system can be evaluated using synthetic multilingual datasets covering different languages, accents, incomplete information, ambiguity, code-switching, and safety-sensitive scenarios.

### 15. Future interoperability
The platform is designed so that Msaada can eventually connect with existing health information systems, referral networks, and benefits-navigation services rather than becoming another isolated health database.

### 16. Community reporting + CHV dispatch
Msaada is not a CHV-only system. **Any community member** — a neighbour, a teacher, a community leader, even someone without an account — can submit a concern through the public `/report` form. The full flow is:

**Community member submits concern** → **AI structures the free-text** (reuses the same Qwen `classifyObservation` used for CHV encounters) → **deterministic policy engine routes it** (reuses the same `evaluatePolicy`, never the model alone) → **a `ResponseCase` is created and a CHV is assigned** (deterministic assignment, ownership-scoped) → **the CHV is notified in-app** (`CaseNotifications` toasts poll for new assignments) → **the CHV attends** (`/cases` dashboard: accept → advance → resolve) → **an encounter can be created from the case** (closing the loop into the existing identity → encounter → referral → follow-up chain) → **an outcome is recorded**.

This keeps the same non-negotiables intact: the AI cannot override the safety rules, the crisis override fires unconditionally, the policy version is audit-logged, and managers see community demand + response status through the `CommunityIntelligenceWidget` — never raw reporter PII.

---

## What makes Msaada different

We are not asking vulnerable people to download another chatbot. We are strengthening the **existing community health network**. A CHV already visits households. Msaada gives that CHV better tools to capture information, operate offline, identify when follow-up is needed, coordinate referrals, and ensure that important community signals reach the people responsible for public-health decisions.

Mental health is our initial use case, but the underlying infrastructure can become a broader **Community Health Intelligence Layer** for Kenya and other African health systems.

---

## Current Progress

Working hackathon MVP built with Next.js + Qwen AI. End-to-end functional with seeded synthetic data.

| Feature | Status |
|---|---|
| Institutional onboarding + invitation-based CHV creation | ✅ |
| Role-based auth (9 roles: MoH, County Admin, Supervisor, CHV, etc.) | ✅ |
| Identity chain (Household → Member → Encounter → Observation) | ✅ |
| Qwen AI triage (structured JSON, retry + fallback) | ✅ |
| Deterministic policy engine (separate from AI, v1.0.0) | ✅ |
| Non-dismissable crisis panel (Kenya Red Cross 1199) | ✅ |
| Referral lifecycle (8 states) | ✅ |
| Follow-up tracking (pending → done/missed, linked to referrals) | ✅ |
| County aggregate dashboard (RBAC, time-range, CSV, charts) | ✅ |
| Compliance audit trail (policy-version logged) | ✅ |
| Supervisor roster (per-CHV de-identified) | ✅ |
| PII scrubber (8 Kenya-specific types, before model) | ✅ |
| 6 defense layers (never-persist → scrub → aggregate → ownership → audit → rate-limit) | ✅ |
| Community reporting — public `/report` form (anonymous submit, no account) | ✅ |
| AI intake + deterministic safety routing for community reports (reuses classifyObservation + evaluatePolicy) | ✅ |
| Response case domain + CHV dispatch (assign → accept → advance → resolve) | ✅ |
| CHV response workflow dashboard (`/cases`) | ✅ |
| In-app case notifications (CaseNotifications poll + toast) | ✅ |
| Community report → encounter link (close loop into existing identity chain) | ✅ |
| Community intelligence widget (demand + response status for managers) | ✅ |
| Community report analytics + audit events | ✅ |
| Offline-first sync + Android app | ☐ Production target |
| NATS JetStream + Temporal workflows | ☐ Production target |

---

## Quick Start

**Prerequisites:** Node.js 20+ (`node -v`). On Windows, run npm scripts from a **Git Bash** terminal in VS Code (they use `tee`/`cp`).

```bash
bun install            # canonical — bun.lock is committed; npm is NOT pinned (package-lock.json is intentionally ignored) and may drift on transitive dev deps (e.g. newer lint plugins can fail `npm run lint` until realigned with bun.lock)
npx prisma generate
npm run dev            # → http://localhost:3000
```

No database setup is needed: on first boot the app **self-provisions** its SQLite database (`db/custom.db`) — full schema DDL + demo seed run automatically (see "Vercel demo mode" below; the same bootstrap runs locally). `npm run db:push` remains available as an explicit alternative, and `npx prisma studio` browses the data.

**Optional `.env.local`** (git-ignored) — without it the app runs with deterministic triage fallback and the Supabase layer off:

```bash
QWEN_API_KEY=<your ModelScope key>          # enables live AI triage
NEXT_PUBLIC_SUPABASE_URL=<project url>      # enables encounter-draft sync +
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon key>  # community-report mirror
```

**Demo accounts** (both seeded automatically on a fresh database):
- CHV: `demo@msaada.health` / `msaada123`
- County Admin (powers the `/admin` onboarding demo): `county.admin@msaada.health` / `msaada123`

**Demo data** (also seeded automatically, idempotent by stable codes — safe on every cold start): a Kilifi County organization + Malindi Town CHU, 4 households with 6 members for the demo CHV, 5 backdated encounters (9 days → today, mixed text/voice capture, online/offline/intermittent connectivity) with structured triage verdicts covering every workflow class (routine, needs_followup, needs_facility_referral, crisis_override), 2 referrals (one completed, one in-progress emergency), 3 follow-ups, audit-log entries, and 4 community reports with response cases. Dashboards, households, referrals, follow-ups and the audit page are all populated the moment you sign in — no Qwen calls needed. `POST /api/seed` remains available for extra Qwen-generated synthetic transcripts.

**Tech Stack:** Next.js 16 (App Router, TypeScript) + Qwen (ModelScope OpenAI-compatible API) + Supabase (client helpers + session proxy) + Prisma + Tailwind CSS 4 + shadcn/ui + Recharts

**GitHub:** https://github.com/Roy-Wanyoike/msaada

**Presentation:** view the 12-slide judge-facing deck at **`/presentation`** in the running app (keyboard navigation, speaker notes, fullscreen) — sources live in `public/slides/`, and the original `public/presentation/Msaada-Pitch-Deck.pptx` is downloadable from the same page.

---

## Engineering workflow

Msaada is built **issue-first** under a written operating model — digest in [ENGINEERING.md](ENGINEERING.md), enforced by the templates under `.github/`:

- **No direct pushes to `main`.** Every change is **1 issue → 1 branch (`chore|MVP-<n>-slug`) → 1 PR (`Closes #n`) → review → squash merge → issue auto-closes.**
- Issues use the standardized **BUG / FEATURE / SECURITY** forms (`.github/ISSUE_TEMPLATE/`) carrying the required impact declarations and Given/When/Then acceptance criteria; PRs carry the 17-section template + author self-review checklist (`.github/pull_request_template.md`).
- One command answers *"is this repository healthy?"*:

```bash
npm run verify          # prisma generate → tsc --noEmit → eslint → next build
npm run verify:smoke    # + standalone server on a throwaway DB: /api/health, demo login, /presentation, revoked-cookie replay
```

---

## Deployment (Vercel)

The app deploys to Vercel as-is (`next build` with Turbopack). Configure the environment variables below before the first deploy — they are all resolved lazily at call time, so a deploy never fails at build for a missing variable.

| Variable | Scope | Purpose |
|---|---|---|
| `DATABASE_URL` | Server | Prisma connection string. **Optional on Vercel**: when unset (or pointing at a non-`/tmp` `file:` path), the app self-provisions an ephemeral SQLite database in `/tmp` at cold start — schema DDL + demo seed run automatically via the `instrumentation.ts` bootstrap (see "Vercel demo mode" below). Local default is `file:./db/custom.db`. |
| `MSAADA_SESSION_SECRET` | Server | **Required.** HMAC key that signs the `msaada_session` cookie — must be ≥ 32 chars (e.g. `openssl rand -base64 48`). Needed for login even in demo mode; without it every login returns `503 SERVER_NOT_CONFIGURED`. |
| `QWEN_API_KEY` | Server | ModelScope API key for the Qwen chat-completions endpoint. Powers AI triage, report intake, dashboard summaries and follow-up suggestions. |
| `QWEN_BASE_URL` | Server | Optional. Defaults to `https://api-inference.modelscope.ai/v1`; override for DashScope/Model Studio accounts. |
| `QWEN_MODEL` | Server | Optional. Defaults to `Qwen-Ambassador/Qwen3.8-Max`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Client+Server | Supabase project URL (public by design, e.g. `https://mwpyllhgjihvbtmhbbjl.supabase.co`). Unset = the Supabase layer stays off. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client+Server | Supabase publishable (anon) key — safe to expose in the browser. Never use the `service_role` key here. |

Set the variables in **Vercel → Settings → Environment Variables**, then trigger a **Redeploy** so the running deployment picks them up. `NEXT_PUBLIC_*` values are inlined at **build** time — adding them without a redeploy changes nothing on the running site.

### Vercel demo mode (self-bootstrapping database)

The Prisma layer uses SQLite and the database file is not tracked in git (repo hygiene, #14) — so a fresh Vercel deployment starts with **no database** and the function bundle is read-only. `src/instrumentation.ts` solves this: on every serverless cold start (before the first request is served) it pins `DATABASE_URL` to `file:/tmp/msaada-demo.db`, applies the full schema DDL (`src/lib/db-ddl.ts`, generated from `prisma/schema.prisma`), and seeds the demo accounts, community reports and the full demo identity chain (households → encounters → triage → referrals → follow-ups). All idempotent, with a fast path that skips DDL when the schema is already present **and current** — the probe checks a table introduced by the latest schema (the auth tables), so databases created by older deploys are upgraded in place on the next cold start.

Consequences for judges / demos:
- The deployed site works immediately once **`MSAADA_SESSION_SECRET`** is set — a ≥32-char random string (`openssl rand -base64 48`). It is **required for login even in demo mode** (a Vercel deployment runs `NODE_ENV=production`, and the session-signing guard refuses to issue cookies without it — every login attempt returns `503 SERVER_NOT_CONFIGURED` until the variable exists). `DATABASE_URL` is the only optional variable: demo login (`demo@msaada.health` / `msaada123`), triage, reports and the dashboard all function against the self-provisioned SQLite database.
- `/tmp` storage is **per-lambda-instance and ephemeral**: writes survive while the instance is warm, then reset on the next cold start. Do not treat the Vercel deployment as durable storage.
- Durable data belongs in the **Supabase layer** (encounter drafts + community report mirror), which activates once the two `NEXT_PUBLIC_SUPABASE_*` variables are set and `supabase/schema.sql` has been run in the SQL editor.

### Supabase

Supabase is an optional enhancement layer. With the two `NEXT_PUBLIC_SUPABASE_*` variables unset, the app runs entirely on its own cookie-session auth + Prisma database, and every piece below degrades to a no-op:

- `src/utils/supabase/client.ts` — browser client for Client Components (`createBrowserClient` from `@supabase/ssr`, memoized singleton); returns `null` when Supabase isn't configured.
- `src/utils/supabase/server.ts` — server client for Server Components / Route Handlers, wired to `next/headers` cookies: it reads the whole cookie store for token refreshes and writes every `Set-Cookie` the SDK emits back.
- `src/utils/supabase/config.ts` — lazy, call-time validation of the two public env vars. Nothing throws at module scope (so `next build` never breaks for deploys without Supabase); `requireSupabaseConfig()` throws a clear error only where Supabase is genuinely required.
- `src/proxy.ts` — implements the Next.js 16 **proxy** convention (the network-boundary file formerly named `middleware.ts` with a `middleware` export) and refreshes Supabase auth sessions via `src/utils/supabase/middleware.ts` before requests hit route handlers or Server Components. It is a strict pass-through when the Supabase env is unset, so local dev and un-configured deploys are unaffected.
- `supabase/schema.sql` must be run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query). It is idempotent (safe to re-run) and creates the `todos` demo table, the `community_reports` cloud-mirror table, the `encounter_drafts` offline-sync table, and the **authentication schema** (`auth_sessions`, `auth_events`, `password_reset_tokens` — RLS enabled, no client policies: only the server's service-role path may touch them), all protected by row-level security (RLS) policies.

### AI provider notes

- The single model client (`src/lib/ai/client.ts`) talks to the **ModelScope OpenAI-compatible inference API** (Hack for Humanity with Qwen) over plain `fetch` — no SDK dependency. Default model: `Qwen-Ambassador/Qwen3.8-Max` (override with `QWEN_MODEL`).
- ModelScope hosts **chat models only** — there is no ASR (speech-to-text) model on that endpoint. `/api/transcribe` therefore returns `501 ASR_NOT_AVAILABLE` and the UI asks the CHV to type the observation instead.
- Escape hatch for voice notes: point `QWEN_ASR_BASE_URL` (ASR calls only) at DashScope — e.g. `https://dashscope.aliyuncs.com/compatible-mode/v1` with `QWEN_ASR_MODEL=qwen3-asr-flash` — so chat stays on ModelScope while speech-to-text runs on DashScope.

---

## Routes

| Path | Persona | Key features |
|---|---|---|
| `/` | CHV | Identity-gated observation submission (household → member → encounter → observation). Non-dismissable crisis panel. Pending follow-ups list. |
| `/report` | **Public (no account)** | Multi-step community reporting form. Anonymous submit. Triggers AI intake + policy routing on submit. |
| `/cases` | CHV | Response-case dashboard: accept → advance → resolve. In-app `CaseNotifications` toasts poll for new assignments. |
| `/households` | CHV | Assigned households, members, encounter history. Ownership-scoped (CHV sees only their assigned households). |
| `/referrals` | CHV / Supervisor | Referral lifecycle (8 states: created → sent → acknowledged → in_progress → completed/declined/cancelled/expired). |
| `/report/mine` | CHV | De-identified weekly activity report (print-friendly). |
| `/settings` | CHV | CHV profile (county / ward / community health unit). |
| `/dashboard` | County / MoH | Aggregate charts (county / day / tag), time-range, CSV export, RBAC, freshness badge. `CommunityIntelligenceWidget` shows community demand + response status. |
| `/supervisor` | Supervisor | De-identified per-CHV roster (workload, escalations, last active). |
| `/audit` | Compliance | Policy-version-logged audit trail of triage, referrals, follow-ups, community-report events. |
| `/admin` | MoH / County Admin | Institutional onboarding + invitation-based CHV creation. |
| `/docs` | All | Project documentation hub. |
| `/presentation` | All | 12-slide pitch-deck viewer — keyboard navigation, clickable dots + slide index, speaker-notes panel, fullscreen, `.pptx` download. |
| `/status` | All | Live dependency status (Database / Qwen AI / Supabase) — green / amber (not configured) / red cards, auto-refreshes every 30 s. |

---

## API surface

All routes are server-side; auth is cookie-session (`msaada_session`) backed by a **server-side session registry**: every issued token is stored as a SHA-256 hash in `AuthSession`, so sessions are revocable (logout revokes the row; a replayed cookie is rejected) and validation is two-layer — HMAC signature + unrevoked/unexpired DB row, failing closed on any DB error. Login/logout attempts are recorded in the append-only `AuthEvent` audit trail (never passwords, tokens, or IPs). Password-reset tokens use the same hash-only storage (`PasswordResetToken`, schema live, flow pending). Sensitive endpoints are rate-limited (`src/lib/rate-limit.ts`). The raw observation/reporter text is never persisted — only model-returned structured fields + de-identified metadata.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/signup` `/login` `/logout` `/me` | POST / POST / POST / GET | Demo auth (scrypt-hashed passwords, HMAC cookie + DB-backed revocable session, audit events). |
| `/api/triage` | POST | Qwen classify + de-identified DB write (CHV encounter). Creates follow-up if needs_followup / needs_facility_referral. |
| `/api/seed` `/demo-chv` | POST / POST | Synthetic transcripts + demo CHV seeding. |
| `/api/dashboard` | GET | Aggregate stats (byCounty / byDay / byTag / totals) — never selects indicator text. |
| `/api/records/mine` `/api/stats/mine` | GET / GET | CHV-scoped records + personal impact stats. |
| `/api/households` `/[id]` `/[id]/members` | GET,POST / GET / POST | Household CRUD + member creation. Ownership-scoped. |
| `/api/encounters` | POST | Create encounter (identity-gated). |
| `/api/referrals` | GET, PATCH | Referral lifecycle (8 states). |
| `/api/followups` `/[id]` | GET / PATCH | Follow-up list (mine) + resolve (done / missed). |
| `/api/audit` | GET | Audit-trail feed (policy-version-logged). |
| `/api/supervisor/roster` | GET | De-identified per-CHV roster (county + days filter). |
| `/api/invitations` `/[token]` | POST / POST | Invitation-based CHV onboarding. |
| `/api/community-reports` | POST (public), GET (authed) | **Community member submits a concern** (no account). Authed list for CHVs/supervisors. |
| `/api/community-reports/[id]` | GET (authed) | Fetch a single community report. |
| `/api/community-reports/[id]/process` | POST | **AI structuring + deterministic policy routing** (reuses `classifyObservation` + `evaluatePolicy` — no duplication). Crisis override fires unconditionally. |
| `/api/response-cases` | GET (authed) | List response cases (mine / assigned / open). |
| `/api/response-cases/[id]` | GET, PATCH | Case lifecycle (assigned → accepted → in_progress → resolved). |
| `/api/response-cases/[id]/assign` | POST | Deterministic CHV assignment (ownership-scoped; supervisor can re-assign). |
| `/api/response-cases/[id]/encounter` | POST | Create an encounter from a case — closes the loop into the existing identity → encounter → referral → follow-up chain. |
| `/api/health` | GET | Public dependency probe (database / qwen / supabase) — always 200, status words only, never echoes config. |

---

## License

MIT — hackathon MVP, not for clinical use without validation + compliance review + authorized Kenyan health-system integration.
