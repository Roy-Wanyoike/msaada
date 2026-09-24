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
| GET  | `/api/followups` | session | List the CHV's own follow-ups (ownership-scoped). `?status=pending\|done\|missed\|all` (default `pending`), `?limit` (max 100). |
| PATCH | `/api/followups/[id]` | session | Resolve a follow-up. Body: `{ status: "done"\|"missed", resolutionNote? }`. Ownership-scoped; 404 if not pending or not owned by the session CHV. |
| GET  | `/api/audit` | — (TODO: compliance RBAC) | Paginated, filterable audit trail (de-identified). `?page&pageSize&county&event&escalation=true` |
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
| `/report/mine` | CHV | Printable weekly report — personal stats + classification breakdown bar + recent observations, `window.print()` with print-only header. AppNav + footer hidden via `print:hidden` |
| `/settings` | CHV | Profile card (email / county / ward + de-identified `chv·xxxx` account id), crisis-line quick-reference card with `tel:` links to Kenya Red Cross 1199 + Befrienders Kenya, session actions (Refresh / Sign out) |

### Seed transcripts (9, mixed Eng/Swa/Sheng)
4 routine · 3 needs-followup · 1 needs-facility-referral · **1 explicit crisis** (self-harm intent + stated means). Backdated across the last 10 days so the daily-trend chart shows a realistic spread.

---

## Follow-up workflow

A core operational loop that closes the gap between "the model said revisit" and "did the revisit happen":

1. **Auto-creation on triage** — when `/api/triage` produces a `needs_followup` or `needs_facility_referral` verdict (and NOT a crisis, which has its own protocol), a `FollowUp` row is written via `createFollowUp` in `src/lib/triage-store.ts`. The due date is `createdAt + 48h`, per the master spec's "revisit within 48h" rule. The call is non-fatal: a failed follow-up write does not fail the triage.
2. **`FollowUp` model** (`prisma/schema.prisma`) — `id`, `createdAt`, `dueAt` (defaults to `+48h`), `status: "pending" | "done" | "missed"`, `resolvedAt`, `resolutionNote` (de-identified), `triageRecordId` (FK, cascade-delete), `chvId` (ownership-scoped). Indexes on `(chvId, status)`, `dueAt`, `status`.
3. **Ownership-scoped throughout** — `getMyFollowUps(chvId, …)` and `resolveFollowUp({ followUpId, chvId, … })` enforce `chvId` at the data-access layer (the `auth.uid() = submitted_by` RLS equivalent). A CHV sees and resolves only their own follow-ups.
4. **State machine** — `pending` → `done | missed`. A pending follow-up cannot be re-resolved: `PATCH /api/followups/[id]` returns `404 NOT_FOUND_OR_NOT_PENDING` if the row is already resolved or owned by another CHV. `resolvedAt` is stamped on transition; the optional `resolutionNote` is de-identified (the UI explicitly reminds the CHV: "no names/addresses").
5. **CHV-facing panel** — `PendingFollowUps` (`src/components/msaada/PendingFollowUps.tsx`) renders on `/` between the My Impact card and the SubmissionForm. Each row is expandable to show the recommended action + a resolution-note textarea + Mark done / Mark missed buttons. Tone-coded by due urgency (red overdue, amber <6h, muted normal). Live-refreshes after every new triage via a `refreshKey` prop. Lists scroll inside `max-h-96 overflow-y-auto` for long backlogs.
6. **Supervisor / county visibility** — `getFollowUpStats({ county?, days })` returns `{ pending, done, missed, overdue, completionRate, total }`. `/api/dashboard` includes this in its payload (county + days scoped to match the dashboard's RBAC + time-range). The `FollowUpKpiCard` (`src/components/msaada/FollowUpKpiCard.tsx`) renders a full-width card on the dashboard showing completion-rate % (green ≥80 / amber 50–79 / red <50), `X done · Y missed`, and a 3-col breakdown (Pending / Overdue / Done). This is the operational-health metric for the follow-up workflow.

---

## Defense layers (6, in order of the data flow)

1. **Never persist the raw observation** — `/api/triage` sends it to Qwen in-memory and discards it; there is no DB column for it.
2. **PII scrubber before the model** — `src/lib/pii-scrub.ts` redacts phones, emails, national-IDs, M-Pesa codes, vehicle plates, plot numbers, school names, and kinship+name patterns *before* the text reaches Qwen. Defense-in-depth on top of #1.
3. **Aggregate-only dashboard reads** — `getDashboardStats` issues `groupBy` queries that never `select` `observedIndicators`/`chpNextAction`/`confidenceNote` text. The Postgres VIEW equivalent, enforced at the data-access layer.
4. **Ownership-scoped writes** — `insertTriageRecord` requires `submittedById` from the session (the `auth.uid() = submitted_by` RLS equivalent). A CHV can only create records attributed to themselves.
5. **Audit trail** — every triage writes an `AuditLog` row (who/when/where/verdict, never observation text). Viewable at `/audit` and as a strip on `/dashboard`.
6. **Rate-limit per CHV** — `src/lib/rate-limit.ts` (10 submissions/60s, in-memory token bucket, Redis-swap-ready).

> The "Production hardening (TODO, called out for the demo)" subsection inside the RLS & de-identification design section above is the **design-time** snapshot. The current implementation status is in the [Production hardening status](#production-hardening-status) section below.

---

## Production hardening status

The original design-time TODOs (in the RLS & de-identification section above) have been progressively implemented across review rounds r2–r10. Current status:

| Hardening item | Status | Where |
|---|---|---|
| **PII scrubber before the model** | ✅ implemented | `src/lib/pii-scrub.ts` — 8 identifier types: phones, emails, national IDs, M-Pesa codes, vehicle plates, plot numbers, school names, kinship+name patterns |
| **Audit log of every triage call** | ✅ implemented | `AuditLog` Prisma model + `writeAuditEntry()` in `src/lib/triage-store.ts`; viewer at `/audit`; recent-activity strip on `/dashboard` |
| **Rate-limit `/api/triage` per CHV** | ✅ implemented | `src/lib/rate-limit.ts` — in-memory token bucket (10 submissions/60s per CHV), returns 429 + `Retry-After`; Redis-swap-ready (one-line change) |
| **County-level RBAC on dashboard** | ✅ implemented | `/api/dashboard?scope=mine` county-scopes via `getDashboardStatsForCounty(chv.county, days)`; `/api/audit?county=…` filterable; UI toggle on `/dashboard` (Kilifi/All segmented control). The all-county path remains open for the demo/judge view; production would gate it behind an admin/national role |
| Move RLS into Postgres | ☐ remaining | Move `auth.uid() = submitted_by` + the aggregate VIEW into actual Postgres RLS policies when landing on Supabase |
| Compliance-officer RBAC role | ☐ remaining | `/api/audit` and `/api/supervisor/roster` are open for the demo; production needs an auditor/supervisor role gate (currently `— TODO: compliance/supervisor RBAC` in the API surface table) |
| Realtime push of new audit entries | ☐ remaining | `/audit` and the dashboard audit strip currently require manual refresh; production would push new `AuditLog` rows via Supabase Realtime subscriptions |

---

## Project structure

```
prisma/schema.prisma              # ChvUser, TriageRecord, AuditLog, FollowUp models
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
  report/mine/page.tsx           # CHV: printable weekly report (AppNav hidden via print:hidden)
  settings/page.tsx              # CHV: profile + crisis-line quick reference + session actions
  api/
    triage/route.ts               # POST: Qwen classify + PII scrub + de-identified write + audit + createFollowUp
    auth/{signup,login,logout,me}/route.ts
    dashboard/route.ts            # GET: aggregate stats + audit + followUpStats + scope (RBAC)
    records/mine/route.ts         # GET: CHV's own records (ownership-scoped)
    stats/mine/route.ts           # GET: CHV's personal stats (for My Impact card)
    followups/route.ts            # GET: list CHV's own follow-ups (?status=pending|done|missed|all)
    followups/[id]/route.ts       # PATCH: resolve a follow-up (done/missed + note), ownership-scoped
    audit/route.ts                # GET: paginated/filterable audit trail
    supervisor/roster/route.ts    # GET: per-CHV de-identified roster
    seed/route.ts                 # POST: seed synthetic transcripts
    demo-chv/route.ts             # POST: provision demo CHV
src/components/msaada/            # AuthCard, SubmissionForm, CrisisPanel, TriageResultCard,
                                 # MyImpactCard, MyRecentObservations, PendingFollowUps,
                                 # FollowUpKpiCard, AppNav, AuditStrip,
                                 # county-bar-chart, top-tags-chart, classification-donut,
                                 # kpi-card, dashboard-states, dashboard-helpers,
                                 # insight-callouts, county-table, samples
```

---

## 3-minute demo script (for judges)

A step-by-step walkthrough covering all six routes + the follow-up workflow. Print this. Read it aloud. Time it.

**Setup (before the clock starts):** Open the preview in a fresh tab. The dashboard auto-seeds 9 synthetic transcripts on first empty load — no pre-seed action needed. The AppNav top-bar is visible across all back-office routes (`/dashboard`, `/audit`, `/supervisor`, `/report/mine`, `/settings`).

**T = 0:00 — Login (`/`)**
1. On the landing page, click **"Use demo account"** (auto-creates `demo@msaada.health` and logs in via cookie session).
2. Point to the **My Impact** card at the top — "personal de-identified stats: total observations, weekly delta, breakdown by classification, counties covered. Ownership-scoped — `auth.uid() = submitted_by` enforced at the data-access layer; the CHV sees only their own records."
3. Scroll slightly to **My recent observations** — "the CHV's own recent triage verdicts; never another CHV's."

**T = 0:30 — Submit a crisis observation**
4. Open the **Sample transcripts** dropdown in the SubmissionForm → pick **⚠ CRISIS** ("Mtoto amesema ataingia river, ameshanusha blanket…").
5. Click **Submit observation**. Wait ~12–15s for Qwen.
6. The **non-dismissable full-screen crisis panel** fires (red, `role="alertdialog"`, `aria-live="assertive"`, no X, Escape blocked, confirm button disabled 5s with "Wait Ns…" countdown). Say: "Crisis override fires FIRST, ALWAYS. It's a fixed rule in the system prompt — not a model judgment call. Kenya Red Cross 1199 + Befrienders Kenya +254 722 178 177 are surfaced inline. The CHV cannot dismiss this without acknowledging."

**T = 1:00 — Confirm + show the follow-up workflow**
7. Wait the 5 seconds. Click **I have contacted help**.
8. The form returns with an emerald **"Record logged for reporting · ID …"** banner.
9. Scroll to the **Pending follow-ups** panel — "needs_followup and needs_facility_referral triages auto-create a due-in-48h task. The CHV marks done/missed with a de-identified resolution note. This closes the operational gap between 'the model said revisit' and 'did the revisit happen'."
10. (Optional) Expand one row → type a resolution note → click **Mark done**.

**T = 1:30 — County dashboard (`/dashboard`)**
11. Click **Dashboard** in the AppNav top-bar.
12. The dashboard defaults to **County-scoped view (RBAC)** with a green banner — the demo CHV is in Kilifi, so cross-county aggregates are hidden. Toggle the **Kilifi / All** segmented control to flip to the cross-county demo view.
13. Walk the **7d / 14d / 30d** time-range filter. Show the **"Updated just now"** freshness badge (emerald pulse → muted → amber-stale >5min; ticks every 30s).
14. Walk the **KPI grid** (6 cards: Total / Routine / Follow-up / Referral / Escalations / Counties covered).
15. Walk the **Follow-Up KPI card** (full-width): completion rate % + Pending / Overdue / Done breakdown — "operational health metric for supervisors and county officials."
16. Walk the **4 charts** (county bar / daily trend / top tags / classification donut). All `role="img"` + `aria-label` summaries for a11y.
17. Show the **county table** + **Export CSV** button (de-identified counts only).
18. Show the **audit activity strip** at the bottom — "de-identified activity trail — truncated CHV labels, event type, verdict badge."

**T = 2:15 — Compliance audit (`/audit`)**
19. Click **Audit** in the AppNav.
20. Paginated, filterable audit-log viewer: county Select, event Select, escalations-only toggle. Columns: When / Actor / Event / County·Ward / Verdict / Flags. Say: "Every triage verdict is here — never the observation text, never the redacted PII, only counts."

**T = 2:30 — Supervisor roster (`/supervisor`)**
21. Click **Supervisor** in the AppNav.
22. Per-CHV roster: truncated labels (`chv·vm0m`), active/inactive dot, total + per-classification breakdown + escalations, last-active, county/ward. Say: "A supervisor sees workload per volunteer, de-identified."

**T = 2:45 — CHV weekly report (`/report/mine`)**
23. Click **My report** in the AppNav.
24. Printable weekly report: identity card, 4 summary stats (total / this-week-with-trend / escalations / counties), stacked classification breakdown bar, condensed recent-observations list.
25. Click **Print** → print preview opens (AppNav + footer hidden via `print:hidden`, dedicated print-only header for paper output).

**T = 2:55 — Settings + crisis lines (`/settings`)**
26. Click **Settings** in the AppNav.
27. Gradient profile header (CHV name + role + de-identified `chv·xxxx` account id), profile rows (Email / County / Ward / Account ID), crisis-line quick-reference card with **tel:** links to Kenya Red Cross 1199 + Befrienders Kenya.

**T = 3:00 — Stop.**

**Closing one-liner (master-spec framing):**
> *Msaada is a human coordination layer for AI, not an autonomous medical decision-maker.*

---

## Production target

The sandbox MVP is a vertical slice of a larger platform. The master build spec (`upload/Pasted Content_1790088991513.txt`) prescribes the production architecture. This Prisma/SQLite sandbox adapts the Supabase production target faithfully; the Next.js app is the **web layer**.

| Master-spec area | Production target | Sandbox MVP |
|---|---|---|
| **Backend (§45, §59)** | **Go API** → queue/event bus → async workers (AI Worker / Notification Worker / Matching Worker / Follow-up Worker). **Temporal-style workflow orchestration** for the follow-up engine. | Next.js route handlers in `/api/*` are the Go-API-equivalent for the triage slice. Workers are in-process (no queue); the `AuditLog` event spine is the precursor of the workflow chain. |
| **Database (§30, §59)** | Managed **PostgreSQL + PostGIS** | SQLite + Prisma. RLS policies + aggregate VIEW are stubbed in `src/lib/triage-store.ts` with a documented migration path. |
| **Mobile worker app (§35, §36)** | **Android-first** worker app; offline support, local queue, sync, conflict handling. Cases / Tasks / Map / Messages / Follow-ups / Profile tabs. | The web `/` route is the MVP worker surface. Offline/low-connectivity narrative is production-target — critical for Kenyan field workers. |
| **Event-driven case processing (§46)** | CaseCreated → AIAnalysisRequested → AIAnalysisCompleted → CaseAssigned → CaseAccepted → CaseResolved event chain | The `AuditLog` model + `/audit` route capture the same event spine (`triage_classified` / `crisis_override` / `fallback_used`). A Temporal-style workflow orchestration would back this in production. |
| **Multi-channel (§15)** | Web + WhatsApp for MVP; SMS, USSD, Voice, Mobile App allowed | The "paste voice transcript" field on `/` stubs the voice channel. WhatsApp/SMS/USSD are production-target. |
| **Multi-tenancy (§13)** | Organizations as tenants; Org A worker cannot see Org B cases | Single-tenant (Kilifi CHVs only); schema is ready for `organizationId` scoping. |
| **Roles (§12)** | Citizen, Community Worker, Org Case Manager, Org Admin, Verification Officer, Platform Admin, Auditor | CHV (Community Worker), Compliance officer (Auditor), County official, Supervisor. Remaining 3 roles are production-target. |
| **Follow-up engine (§28)** | ASSISTANCE_RECEIVED / STILL_NEEDS_HELP / REFERRED / UNABLE_TO_CONTACT / CASE_REOPENED | Slimmed to `pending / done / missed` (the operational MVP slice). |
| **Consent, attachments, retention (§31, §32)** | Consent capture, attachment storage, retention policies | `resolutionNote` is the de-identified stub for consent-captured follow-up outcomes. |

The swap path (Postgres RLS policies, Supabase Auth, async workers, Android worker app, multi-channel ingress, Temporal workflows) is documented inline in `src/lib/*` and in the RLS & de-identification design section above.

---

## Safety note

Msaada is **not** a diagnostic tool and **not** a therapist. It is a triage-support tool that converts a CHV observation into a standardized flag and, when a crisis is detected, surfaces the Kenya Red Cross (1199) and Befrienders Kenya (+254 722 178 177) crisis lines. The crisis-override logic in the system prompt is **fixed and must not be modified** — it fires first, always, on any indication of suicidal ideation, expressed intent to self-harm, a stated means/plan, or acute danger to self or others.
