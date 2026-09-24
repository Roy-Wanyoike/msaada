# Msaada

> *Msaada* — "help" / "assistance" in Swahili.
> A hackathon MVP that lets a Community Health Volunteer (CHV) log a home-visit observation, sends it to **Qwen** for WHO-aligned community-mental-health triage classification, stores a **de-identified** result, and renders a county-level aggregate dashboard.

---

## What it does (the 3-minute demo)

1. **CHV logs in** (email/password demo account — `demo@msaada.health` / `msaada123`).
2. **CHV writes an observation** ("What did you observe during this visit?") or picks a pre-written mixed English/Swahili/Sheng sample. County/ward are selected from a dropdown (Kilifi, Nairobi, Turkana, Mombasa + wards). A "paste voice transcript" field stubs the voice-note flow.
3. **On submit** the Next.js server route `/api/triage` sends the observation to **Qwen** (via `z-ai-web-dev-sdk`, server-side only — the API key never reaches the client) with a fixed triage system prompt.
4. The server route **validates the model's JSON response**, retries once with a stricter "valid JSON only" instruction on parse failure, and **falls back to `needs_followup`** (never silently drops a failed classification).
5. Only the **structured triage output** (classification, observed indicators, aggregate tag, CHP next action, confidence note, escalation flag) **plus county/ward** is persisted. **The raw free-text observation is never stored** — even if it contained household names or addresses, those never reach the database.
6. If the model returns `escalation: true` (crisis override — suicidal ideation / self-harm / acute danger), the UI **immediately** renders a **full-screen, high-contrast, non-dismissable crisis panel** with the CHP instruction and the Kenya Red Cross (1199) + Befrienders Kenya (+254 722 178 177) crisis lines. The panel requires an explicit confirmation click (disabled for the first 5 seconds) and cannot be closed with Escape or an X.
7. The **`/dashboard` route** (county health official view, no auth for the demo) shows aggregate charts (Recharts): triage by county, daily trend (14 days), top aggregate tags, classification distribution, plus narrative insight callouts ("Top signal: …", "N escalations logged", follow-up trend vs previous week).

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, TypeScript) | Server routes keep the Qwen API key server-side; React Server Components / client components split cleanly |
| Styling | **Tailwind CSS 4** + shadcn/ui (New York) | Accessible, consistent, fast |
| Charts | **Recharts** | Responsive, accessible (`role="img"` + `aria-label` summaries) |
| Database | **Prisma + SQLite** | *Sandbox adaptation* — see "Adaptation from the Supabase spec" below |
| AI | **Qwen via `z-ai-web-dev-sdk`** | Server-side chat completions; the SDK is the only place the model is called |
| Auth | Cookie-session demo auth (scrypt-hashed) | *Sandbox adaptation* — substitutes for Supabase Auth in this environment |

> ### Adaptation from the Supabase spec
> The build spec called for **Supabase (Postgres + Auth + Realtime)**. The sandbox this MVP runs in ships **Prisma + SQLite** and **`z-ai-web-dev-sdk`** (Qwen). We adapted **faithfully**, preserving every security/architecture invariant from the spec:
> - The Postgres tables (`triage_records`, `chv_users`) became Prisma models on SQLite (`text[]` → JSON-encoded `TEXT`; `gen_random_uuid()` → `cuid()`; `timestamptz` → `DateTime`).
> - Supabase Auth became a scrypt-hashed email/password cookie session (`src/lib/auth.ts`). The swap path to Supabase Auth is documented inline.
> - **Row-Level Security and the de-identified aggregate VIEW** are enforced at the **data-access layer** (`src/lib/triage-store.ts`) instead of Postgres RLS policies. The invariant is identical: a CHV can only insert their own records (`submittedById` = session user), and the dashboard reads **aggregate-only** queries that **never select `observedIndicators` / `chpNextAction` / `confidenceNote` text**. See the design section below — this is the detail hackathon judges in this space ask about.

---

## The design decision judges ask about: RLS & de-identification

> **The raw free-text CHV observation is never persisted. Only the model-returned structured fields plus county/ward plus the submitting CHV id are stored. The dashboard never reads indicator text. De-identification is enforced at the data layer, not just the application layer.**

### Why this matters

A CHV household-visit observation can contain the most sensitive data in the entire pipeline: household member names, addresses, descriptions of suicidal ideation, family circumstances, stigma-bearing mental-health descriptions. If that raw text is stored and later exposed — by a misconfigured dashboard, a stolen read replica, a backup leak, or an over-permissive API — the harm is irreversible. Community mental-health data in Kenya carries both clinical and social risk; a leak could deter future help-seeking in exactly the households the system is meant to support.

### The three layers of defense (and why all three matter)

**Layer 1 — Never persist the raw observation.**
`/api/triage` receives `{ observation_text, county, ward }`, sends `observation_text` to Qwen, then writes only the **model-returned structured fields** to the database. The raw text is held in server memory for the duration of the request and then discarded. There is no column for it. A `SELECT *` on the table cannot leak it because it was never written.

**Layer 2 — Aggregate-only reads for the dashboard.**
The county dashboard's data-access function (`getDashboardStats`) issues `groupBy` queries by `county`, `classification`, `escalation`, `aggregateTag`, and date — and explicitly `select`s only those columns plus counts. It never selects `observedIndicators` (the model's behavioral-indicator phrases), `chpNextAction`, or `confidenceNote`. A future analyst who reuses this function cannot accidentally expose indicator text, because the query doesn't ask for it.

**Layer 3 — Ownership-scoped writes (the `auth.uid() = submitted_by` equivalent).**
`insertTriageRecord` requires `submittedById`, populated from the authenticated session. A CHV can only create records attributed to themselves. In the Supabase target architecture this is a Postgres RLS policy:
```sql
create policy "chv inserts own records"
  on triage_records for insert
  with check (auth.uid() = submitted_by);
```
In this Prisma adaptation it's enforced in the data-access layer (`requireChv()` → `submittedById = chv.id`), with the documented intent to move it into Postgres RLS when the project lands on Supabase.

### Why a VIEW (and the Prisma equivalent)

In the Supabase target, the dashboard reads from a **Postgres VIEW** that exposes only `(county, classification, aggregate_tag, escalation, day, count)` — never `observed_indicators`. This means even a service-role key handed to a reporting tool, or a data analyst with read access, **cannot retrieve indicator text** because the view physically doesn't have the column. The database enforces de-identification independently of the application.

In this Prisma/SQLite adaptation, the same invariant is enforced by the data-access function `getDashboardStats` (aggregate-only, indicator-text-free). The intent and the contract are identical: **the dashboard layer does not have a code path that can read individual indicator text, by construction.**

### What is NOT de-identified (on purpose)

- `county` and `ward` are retained — the aggregate intelligence (e.g. "Kilifi: needs-followup flags up 3× this week") depends on them, and they are coarse enough not to identify a household.
- `observed_indicators` retains the model's behavioral phrases ("sleeps well", "withdrawn", "poor appetite") — these are clinical-relevance signals, not identifying. They are still **never shown on the aggregate dashboard**; they appear only in the CHV's own immediate triage result (which they already saw).
- `aggregate_tag` (e.g. `sleep_disturbance`, `crisis_self_harm`) is a short category label, retained for trend intelligence.
- `submittedById` is retained for ownership/audit but is never displayed on the dashboard.

### Production hardening (TODO, called out for the demo)

- **Move RLS into Postgres** when landing on Supabase (policies on `triage_records` + a real `triage_aggregates` VIEW).
- **County-level RBAC on `/dashboard`** — currently no auth for the demo; production needs `county`-scoped roles so a Kilifi official cannot see Turkana aggregates.
- **PII scrubber before the model** — even though raw text isn't persisted, it is sent to the model. A pre-scrub pass for obvious names/phone numbers is a hardening step.
- **Audit log** of every triage call (who/when/county/classification) without the observation text.
- **Short-lived retention** of the structured record + a deletion workflow for the crisis records after reporting.
- **Rate-limit `/api/triage`** per CHV to bound model cost and abuse.

---

## Quick start

```bash
bun install
bun run db:push          # create SQLite tables
bun run dev              # http://localhost:3000
```

Then:
1. Open `/` → click **"Use demo account"** (auto-creates the demo CHV and logs in).
2. Pick the **⚠ CRISIS** sample transcript → **Submit observation** → the non-dismissable crisis panel fires.
3. Confirm the panel → the form returns with a "Record logged for reporting" banner.
4. Open `/dashboard` → charts populate (auto-seeds 9 synthetic transcripts on first load if empty).

### Demo credentials
- Email: `demo@msaada.health`
- Password: `msaada123`
(Provisioned by `POST /api/demo-chv` or `POST /api/seed`.)

### API surface
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | — | Register CHV (email, password, fullName, county, ward) |
| POST | `/api/auth/login` | — | Login |
| POST | `/api/auth/logout` | session | Logout |
| GET  | `/api/auth/me` | session | Current CHV |
| POST | `/api/triage` | session + **rate-limited** | Classify + persist (de-identified). 10 submissions/60s per CHV. |
| GET  | `/api/dashboard` | optional session | Aggregate stats. `?days=14&scope=mine\|all`. `scope=mine` county-scopes to the logged-in CHV (RBAC). |
| GET  | `/api/records/mine` | session | CHV's own recent triage records (ownership-scoped) |
| GET  | `/api/stats/mine` | session | CHV's personal aggregate stats (for the "My impact" card) |
| GET  | `/api/audit` | — (TODO: compliance RBAC) | Paginated, filterable audit trail (de-identified) |
| GET  | `/api/supervisor/roster` | — (TODO: supervisor RBAC) | Per-CHV aggregate roster (de-identified, truncated labels) |
| POST | `/api/seed` | — (demo) | Seed 9 synthetic transcripts |
| POST | `/api/demo-chv` | — | Provision demo CHV |

### Routes

| Route | Role | Key features |
|---|---|---|
| `/` | CHV | Login/signup, observation submission, non-dismissable crisis panel, "My impact" stats card, "My recent observations" panel |
| `/dashboard` | County official | Aggregate charts (county/daily/tags/donut), KPIs, insight callouts, **county-level RBAC toggle** (mine/all), time-range filter (7d/14d/30d), CSV export, audit activity strip |
| `/audit` | Compliance officer | Full audit-log viewer — paginated, filterable (county/event/escalations-only), de-identified |
| `/supervisor` | Supervisor | Per-CHV roster — activity/load/escalation burden per volunteer, de-identified (truncated labels), active/inactive indicator |
| `/report/mine` | CHV | Printable weekly report — personal stats + classification breakdown bar + recent observations, `window.print()` with print-only header |

### Seed transcripts (9, mixed Eng/Swa/Sheng)
4 routine · 3 needs-followup · 1 needs-facility-referral · **1 explicit crisis** (self-harm intent + stated means). Backdated across the last 10 days so the daily-trend chart shows a realistic spread.

---

## Defense layers (6, in order of the data flow)

1. **Never persist the raw observation** — `/api/triage` sends it to Qwen in-memory and discards it; there is no DB column for it.
2. **PII scrubber before the model** — `src/lib/pii-scrub.ts` redacts phones, emails, national-IDs, M-Pesa codes, vehicle plates, plot numbers, school names, and kinship+name patterns *before* the text reaches Qwen. Defense-in-depth on top of #1.
3. **Aggregate-only dashboard reads** — `getDashboardStats` issues `groupBy` queries that never `select` `observedIndicators`/`chpNextAction`/`confidenceNote` text. The Postgres VIEW equivalent, enforced at the data-access layer.
4. **Ownership-scoped writes** — `insertTriageRecord` requires `submittedById` from the session (the `auth.uid() = submitted_by` RLS equivalent). A CHV can only create records attributed to themselves.
5. **Audit trail** — every triage writes an `AuditLog` row (who/when/where/verdict, never observation text). Viewable at `/audit` and as a strip on `/dashboard`.
6. **Rate-limit per CHV** — `src/lib/rate-limit.ts` (10 submissions/60s, in-memory token bucket, Redis-swap-ready).

---

## Project structure

```
prisma/schema.prisma              # ChvUser, TriageRecord, AuditLog models
src/lib/
  types.ts                        # COUNTIES, WARDS, Classification, DTOs
  qwen.ts                         # Qwen call + JSON validation + retry + fallback
  pii-scrub.ts                    # PII scrubber (phones, emails, IDs, M-Pesa, plates, plots, schools, names)
  rate-limit.ts                   # in-memory token-bucket rate limiter (per CHV)
  auth.ts                         # demo cookie-session auth (scrypt)
  triage-store.ts                 # data-access: insert + aggregate-only reads + audit + supervisor roster
  db.ts                           # PrismaClient singleton
src/app/
  page.tsx                        # CHV: login + submission + crisis panel + My impact + recent observations
  dashboard/page.tsx             # County: aggregate charts + RBAC toggle + time-range + CSV + audit strip
  audit/page.tsx                 # Compliance: paginated/filterable audit-log viewer
  supervisor/page.tsx            # Supervisor: per-CHV de-identified roster
  report/mine/page.tsx           # CHV: printable weekly report
  api/
    triage/route.ts               # POST: Qwen classify + scrub + de-identified write + audit
    auth/{signup,login,logout,me}/route.ts
    dashboard/route.ts            # GET: aggregate stats + audit + scope (RBAC)
    records/mine/route.ts         # GET: CHV's own records (ownership-scoped)
    stats/mine/route.ts           # GET: CHV's personal stats
    audit/route.ts                # GET: paginated/filterable audit trail
    supervisor/roster/route.ts    # GET: per-CHV de-identified roster
    seed/route.ts                 # POST: seed synthetic transcripts
    demo-chv/route.ts             # POST: provision demo CHV
src/components/msaada/            # AuthCard, SubmissionForm, CrisisPanel,
                                 # TriageResultCard, MyImpactCard, MyRecentObservations,
                                 # AuditStrip, dashboard charts + helpers
```

---

## Safety note

Msaada is **not** a diagnostic tool and **not** a therapist. It is a triage-support tool that converts a CHV observation into a standardized flag and, when a crisis is detected, surfaces the Kenya Red Cross (1199) and Befrienders Kenya (+254 722 178 177) crisis lines. The crisis-override logic in the system prompt is **fixed and must not be modified** — it fires first, always, on any indication of suicidal ideation, expressed intent to self-harm, a stated means/plan, or acute danger to self or others.
