# Msaada

> *Msaada* — "help" / "assistance" in Swahili.

**An AI-powered community-health intelligence platform that helps Community Health Volunteers (CHVs) in Kenya capture home-visit observations, structure them with Qwen AI, apply deterministic safety policy, and connect people to the right health-system workflow — without the AI ever becoming the authority over the patient.**

```
AI interprets. Deterministic policy controls safety. Authorized humans control care.
```

---

## The 30-second pitch

Community Health Volunteers walk door-to-door in Kenyan households. They see things — a mother who's stopped sleeping, a child who's withdrawn, a father in acute distress. Today those observations stay in notebooks, get lost, or arrive too late.

**Msaada** lets a CHV speak or type what they observed (in English, Swahili, or Sheng), sends it to **Qwen** for WHO-aligned triage classification, runs that classification through a **separate deterministic policy engine** (the AI can never override or downgrade a safety signal), and creates a referral + follow-up linked to the correct person through a full identity chain — Household → Member → Encounter → Observation → Policy → Referral → Follow-up.

If the observation contains any indication of suicidal ideation or self-harm, a **non-dismissable crisis panel** fires immediately with the Kenya Red Cross (1199) and Befrienders Kenya crisis lines.

The raw observation text is **never persisted**. Ever.

---

## The 3-minute demo (for judges)

| Time | Action | What to show |
|---|---|---|
| 0:00 | Open `/` → click **"Use demo account"** | Auto-logs in as the Kilifi demo CHV. Show the **My Impact** card (personal stats) + **Pending Follow-ups** panel. |
| 0:20 | Click **"Households"** in the top nav → open a household → click a member → **Start encounter** | The identity chain: Household (MSD-HH-XXXX) → Member (MSD-M-XXXX) → Encounter (MSD-ENC-XXXX). The encounter deep-links to the submission form. |
| 0:40 | On the submission form, pick the **⚠ CRISIS** sample transcript → **Submit** | The observation is PII-scrubbed (phones/names/M-Pesa codes redacted) → sent to Qwen → classified as `escalation: true`. |
| 1:00 | **The crisis panel fires** | Full-screen, high-contrast, non-dismissable. 5-second countdown. Kenya Red Cross 1199 + Befrienders Kenya as clickable `tel:` links. Focus-trapped. Cannot be bypassed via refresh (beforeunload guard). |
| 1:20 | **Confirm** the panel → show the **Referral** created (MSD-REF-XXXX, emergency priority) | The deterministic policy engine created an emergency referral + a 24-hour follow-up — both linked to the encounter + member. |
| 1:40 | Click **Dashboard** in the top nav | County-aggregate charts (Recharts), RBAC county-scope toggle (Kilifi/All), time-range filter (7d/14d/30d), freshness badge, **Follow-up completion KPI**, CSV export, audit-activity strip. |
| 2:00 | Click **Audit** | The compliance audit trail — every triage event logged with the policy version + workflow class. De-identified (truncated `chv·xxxx` labels, never emails). |
| 2:15 | Click **Supervisor** | Per-CHV de-identified roster — activity/load/escalation burden per volunteer. |
| 2:30 | Click **Referrals** | The referral lifecycle (8 states: created → sent → acknowledged → in_progress → completed/declined/cancelled/expired). "Referral Created ≠ Help Received." |
| 2:45 | Click **My report** → **Print** | A printable weekly CHV report — personal stats + classification breakdown + recent observations. |
| 3:00 | Close with: **"Msaada is a human coordination layer for AI, not an autonomous medical decision-maker."** | The core principle. |

---

## Quick start

```bash
bun install
bun run db:push          # create SQLite tables
bun run dev              # http://localhost:3000
```

**Demo credentials:** `demo@msaada.health` / `msaada123` (or click "Use demo account" on the login page — auto-provisions).

**Seed data:** the dashboard auto-seeds 9 synthetic transcripts (4 routine, 3 needs-follow-up, 1 facility-referral, 1 explicit crisis) across 4 households + 10 members + 9 encounters + 2 referrals on first load if the DB is empty.

---

## The architecture

```
                    MSAADA — HACKATHON MVP

              ┌───────────────────────────┐
              │     Next.js 16 Web App    │
              │ TypeScript + shadcn/ui   │
              │ 8 routes, 20 APIs        │
              └───────────┬───────────────┘
                          │
                    HTTPS / API
                          │
              ┌───────────▼───────────────┐
              │   Deterministic Policy    │
              │       Engine (v1.0.0)     │
              │  (separate from the AI)   │
              └───────────┬───────────────┘
                          │
              ┌───────────▼───────────────┐
              │  Qwen AI (z-ai-web-dev-  │
              │  sdk) — server-side only  │
              │  Structured interpretation│
              └───────────┬───────────────┘
                          │
              ┌───────────▼───────────────┐
              │  Prisma + SQLite          │
              │  9 models, RLS-equivalent │
              │  data-access layer        │
              └───────────────────────────┘
```

### The identity chain (spec §2, §6, §15, §36)

Every action preserves the chain — **never** create a referral without knowing which member it belongs to:

```
Household (MSD-HH-XXXX)
    ↓
Member (MSD-M-XXXX)         ← names are attributes, never primary keys
    ↓
Encounter (MSD-ENC-XXXX)    ← lifecycle: draft → in_progress → completed → closed
    ↓
Observation                 ← PII-scrubbed → Qwen structures → policy evaluates
    ↓
Policy Decision              ← deterministic, versioned, auditable
    ↓
Referral (MSD-REF-XXXX)     ← lifecycle: created → sent → acknowledged → completed
    ↓
Follow-up (MSD-FU-XXXX)     ← pending → done | missed, due in 24h (crisis) / 48h
```

### The deterministic policy engine (the design decision judges ask about)

> **The AI produces interpretation. A separate, deterministic, versioned, auditable policy engine controls the workflow decision. The AI can NEVER override or downgrade a safety-critical signal.**

```typescript
// src/lib/policy-engine.ts — PURE function, no side effects, no I/O
// Testable. Deterministic. Independently deployable from the model.

export function evaluatePolicy(interpretation: ModelInterpretation): PolicyDecision {
  // CRISIS OVERRIDE — fires first + unconditionally. The AI cannot downgrade this.
  if (interpretation.escalation) {
    return { workflowClass: "crisis_override", referralPriority: "emergency", ... };
  }
  // FALLBACK — never silently drop. Default to caution (human_review).
  if (interpretation.fallbackUsed) {
    return { workflowClass: "human_review", ... };
  }
  // NORMAL — deterministic mapping from classification to workflow.
  switch (interpretation.classification) {
    case "routine":              return { workflowClass: "routine", ... };
    case "needs_followup":       return { workflowClass: "follow_up_required", ... };
    case "needs_facility_referral": return { workflowClass: "referral_required", ... };
  }
}
```

Referral destinations come from an **authorized config** (`AUTHORIZED_DESTINATIONS`) — never invented by the AI (spec §12, §27).

---

## The 6 defense layers (de-identification, in data-flow order)

| # | Layer | What it does | Where |
|---|---|---|---|
| 1 | **Never persist the raw observation** | `/api/triage` sends the text to Qwen in-memory and discards it. There is no DB column for it. | `triage-store.ts` |
| 2 | **PII scrubber before the model** | Redacts phones, emails, national-IDs, M-Pesa codes, vehicle plates, plot numbers, school names, and kinship+name patterns **before** the text reaches Qwen. 8 Kenya-specific identifier types. | `pii-scrub.ts` |
| 3 | **Aggregate-only dashboard reads** | Dashboard queries are `groupBy` that never `select` indicator text. The Postgres VIEW equivalent, enforced at the data-access layer. | `triage-store.ts` |
| 4 | **Ownership-scoped writes** | Every record requires `submittedById` from the HMAC-signed session. A CHV can only create/access their own records + assigned households. | `auth.ts`, `identity-store.ts` |
| 5 | **Audit trail** | Every triage writes an `AuditLog` row (who/when/where/verdict/policy-version/referral — never observation text). Tamper-resistant, access-controlled. | `AuditLog` model |
| 6 | **Rate-limit per CHV** | Token-bucket: 10 triage submissions / 60s per CHV + 3 seeds / 10min per IP. Redis-swap-ready. | `rate-limit.ts` |

**What is NOT de-identified (on purpose):** `county` and `ward` (coarse enough for aggregate intelligence), `observed_indicators` (model-derived behavioral phrases like "sleeps well" — clinical-relevance signals, not identifying; shown only in the CHV's own result, never on the aggregate dashboard), `aggregate_tag` (short category label for trends).

---

## Routes (8, role-based)

| Route | Role | Key features |
|---|---|---|
| `/` | CHV | Login/signup, **identity-gated submission** (select household → member → start encounter → observe), non-dismissable crisis panel, My Impact card, Pending Follow-ups, Recent Observations |
| `/households` | CHV | Household workflow — create households, add members (kinship labels, not names), start encounters → deep-link to submission |
| `/dashboard` | County official | Aggregate charts (county/daily/tags/donut), KPIs, insight callouts, **RBAC county-scope toggle** (mine/all), time-range filter, freshness badge, Follow-up completion KPI, CSV export, audit strip |
| `/audit` | Compliance | Full audit-log viewer — paginated, filterable (county/event/escalations-only), de-identified |
| `/supervisor` | Supervisor | Per-CHV de-identified roster — activity/load/escalation burden, active/inactive indicator |
| `/referrals` | CHV | Referral lifecycle (8 states, tone-coded, identity chain, authorized destinations) |
| `/report/mine` | CHV | Printable weekly report — personal stats + classification breakdown + recent observations, `window.print()` |
| `/settings` | CHV | Profile + crisis-line `tel:` quick-reference + session actions |

A unified **AppNav** top-bar connects all back-office routes with an animated active-state underline.

## API surface (20 endpoints)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | — | Register CHV |
| POST | `/api/auth/login` | — | Login (HMAC-signed session) |
| POST | `/api/auth/logout` | session | Logout |
| GET | `/api/auth/me` | session | Current CHV |
| POST | `/api/triage` | session + rate-limited | PII-scrub → Qwen → policy engine → de-identified write + referral + follow-up + audit |
| GET | `/api/dashboard` | optional session | Aggregate stats. `?days=14&scope=mine\|all` (RBAC) |
| GET | `/api/records/mine` | session | CHV's own triage records (ownership-scoped) |
| GET | `/api/stats/mine` | session | CHV's personal aggregate stats |
| GET | `/api/followups` | session | CHV's follow-ups. `?status=pending\|done\|missed\|all` |
| PATCH | `/api/followups/[id]` | session | Resolve a follow-up (done/missed) + de-identified note |
| GET | `/api/audit` | — (TODO: compliance RBAC) | Paginated, filterable audit trail |
| GET | `/api/supervisor/roster` | — (TODO: supervisor RBAC) | Per-CHV de-identified roster |
| GET/POST | `/api/households` | session | List/create households (ownership-scoped) |
| GET | `/api/households/[id]` | session | Household + members |
| POST | `/api/households/[id]/members` | session | Add a member |
| GET/POST | `/api/encounters` | session | List/start encounters (identity chain) |
| GET | `/api/referrals` | session | CHV's referrals. `?status=` filter |
| POST | `/api/seed` | — (rate-limited 3/10min) | Seed 9 synthetic transcripts + households + referrals |
| POST | `/api/demo-chv` | — | Provision demo CHV |

---

## The Qwen triage system prompt

The system prompt is **fixed** — the crisis-override logic must not be modified:

> *You are Msaada, an AI triage-support tool for Community Health Volunteers (CHVs) in Kenya conducting routine household visits. You are NOT a diagnostic tool and NOT a therapist.*
>
> *CRISIS OVERRIDE (check first, always): If the observation contains any indication of suicidal ideation, expressed intent to self-harm, a means/plan mentioned, or acute danger to self or others, output ONLY:* `{"escalation": true, "chp_instruction": "Do not leave the household unaccompanied. Contact your CHV supervisor and the nearest Level 4+ facility immediately. If immediate danger, call Kenya Red Cross Emergency: 1199.", "crisis_line": "Kenya Red Cross Emergency: 1199 | Befrienders Kenya: +254 722 178 177", "record_for_reporting": true}`
>
> *Otherwise classify into exactly one of: routine, needs_followup, needs_facility_referral. Never diagnose. Describe only observed behavioral indicators (sleep, appetite, withdrawal, expressed distress) — never clinical labels.*
>
> *If information is too limited to classify confidently, default to needs_followup rather than routine — under-triage is the higher-risk error.*

The route validates the JSON response, retries once with a stricter "valid JSON only" instruction on parse failure, and falls back to `needs_followup` (never silently drops a failed classification).

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, TypeScript) | Server routes keep the Qwen API key server-side; the SDK is the only place the model is called |
| Styling | **Tailwind CSS 4** + shadcn/ui (New York) | Accessible, consistent, fast |
| Charts | **Recharts** (code-split via `next/dynamic`) | Responsive, accessible (`role="img"` + `aria-label` summaries) |
| Database | **Prisma + SQLite** | *Sandbox adaptation* — see below |
| AI | **Qwen via `z-ai-web-dev-sdk`** | Server-side chat completions; the key never reaches the client |
| Auth | HMAC-signed cookie session (scrypt-hashed passwords) | *Sandbox adaptation* — substitutes for Supabase Auth |
| Policy | **Deterministic policy engine** (`policy-engine.ts`) | Separate from the AI, versioned, auditable, testable |

### Sandbox adaptation note

The build spec called for **Supabase (Postgres + Auth + Realtime)**. This sandbox ships **Prisma + SQLite** and **`z-ai-web-dev-sdk`** (Qwen). We adapted faithfully:
- Postgres `text[]` → JSON-encoded `TEXT`; `gen_random_uuid()` → `cuid()`
- Supabase Auth → HMAC-signed cookie session (scrypt-hashed, forgeable-token vulnerability closed)
- Postgres RLS → enforced at the data-access layer (`triage-store.ts` + `identity-store.ts`) — ownership-scoped writes, aggregate-only reads
- The Postgres VIEW (aggregate-only) → `getDashboardStats` groupBy queries that never select indicator text

---

## Production target

This MVP is the **Next.js web layer** of a larger platform the master spec prescribes:

| Layer | Technology | Status |
|---|---|---|
| **Web** | Next.js + TypeScript + shadcn/ui | ✅ This MVP |
| **AI Gateway** | Qwen behind an abstraction | ✅ This MVP (single model) |
| **Deterministic policy** | Versioned, auditable, separate from AI | ✅ This MVP |
| **Go backend** | Domain + application logic | ☐ Production target |
| **PostgreSQL + PostGIS** | Core data + geographic intelligence | ☐ (sandbox uses SQLite) |
| **NATS JetStream** | Async events (encounter.created, referral.acknowledged…) | ☐ Production target |
| **Temporal** | Durable workflows (referral, follow-up, AI processing) | ☐ Production target |
| **Android CHW app** | Kotlin + Compose, offline-first | ☐ Production target |
| **Multi-channel** | WhatsApp / SMS / USSD | ☐ Production target |
| **Postgres RLS** | Row-level security at the DB layer | ☐ (sandbox enforces at data-access layer) |
| **Compliance RBAC** | Roles for CHV/Supervisor/County/Admin | ☐ (sandbox uses ownership-scoping + documented TODOs) |
| **Offline-first sync** | Local outbox + idempotent sync API | ☐ Production target |
| **Security test suite** | OWASP + prompt-injection + identity-confusion | ☐ Production target |

---

## Project structure

```
prisma/schema.prisma              # 9 models: ChvUser, TriageRecord, AuditLog, FollowUp,
                                 # Household, HouseholdMember, Encounter, Referral, PolicyVersion
src/lib/
  types.ts                        # COUNTIES, WARDS, Classification, DTOs
  identity-types.ts               # HouseholdDTO, MemberDTO, EncounterDTO, ReferralDTO + generateCode()
  qwen.ts                         # Qwen call + JSON validation + retry + fallback
  pii-scrub.ts                    # 8-type PII scrubber (phones, emails, IDs, M-Pesa, plates, plots, schools, names)
  rate-limit.ts                   # in-memory token-bucket rate limiter (per CHV)
  policy-engine.ts                # DETERMINISTIC policy engine (separate from the AI)
  auth.ts                         # HMAC-signed cookie session (scrypt)
  identity-store.ts               # data-access for households/members/encounters/referrals
  triage-store.ts                 # data-access for triage + audit + follow-ups + supervisor roster
  db.ts                           # PrismaClient singleton
src/app/
  page.tsx                        # CHV: identity-gated submission + crisis panel + impact + follow-ups
  households/page.tsx            # CHV: household workflow (create, members, start encounter)
  dashboard/page.tsx             # County: aggregate charts + RBAC + time-range + CSV + audit strip
  audit/page.tsx                 # Compliance: paginated/filterable audit-log viewer
  supervisor/page.tsx            # Supervisor: per-CHV de-identified roster
  referrals/page.tsx            # CHV: referral lifecycle (8 states)
  report/mine/page.tsx           # CHV: printable weekly report
  settings/page.tsx              # CHV: profile + crisis-line reference
  api/                           # 20 API routes (see API surface above)
src/components/msaada/            # AppNav, AuthCard, SubmissionForm, CrisisPanel,
                                 # TriageResultCard, MyImpactCard, MyRecentObservations,
                                 # PendingFollowUps, FollowUpKpiCard, AuditStrip,
                                 # dashboard charts + helpers (19 components)
```

---

## Safety note

Msaada is **not** a diagnostic tool and **not** a therapist. It is a triage-support tool that converts a CHV observation into a standardized flag and, when a crisis is detected, surfaces the Kenya Red Cross (1199) and Befrienders Kenya (+254 722 178 177) crisis lines. The crisis-override logic in the system prompt is fixed and must not be modified.

**Reporting language (spec §20):** dashboards say *"reported distress-related observations increased during the selected reporting period"* — never *"depression increased by 30%"* unless the underlying methodology actually supports that statement.

---

## Repository

**GitHub:** https://github.com/Roy-Wanyoike/msaada

**License:** MIT (this is a hackathon MVP — not for clinical use without proper validation, compliance review, and integration with authorized Kenyan health-system resources).
