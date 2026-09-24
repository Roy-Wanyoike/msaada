# Msaada

> *Msaada* — "help" / "assistance" in Swahili.

**An AI-powered community-health intelligence platform that helps Community Health Volunteers (CHVs) in Kenya capture home-visit observations, structure them with Qwen AI, apply deterministic safety policy, and connect people to the right health-system workflow — without the AI ever becoming the authority over the patient.**

---

## Problem

In Kenya, Community Health Volunteers (CHVs) walk door-to-door visiting households — they are the frontline of community health. They observe critical mental-health and social-wellbeing signals every day: a mother who's stopped sleeping, a child who's withdrawn, a father in acute distress, a household pushed to the edge by financial stress.

**Today, those observations are lost.**

- CHVs record observations in paper notebooks that never reach a health system.
- There is no structured way to triage which households need follow-up vs urgent referral.
- When a crisis is brewing — suicidal ideation, self-harm risk — the CHV may be the only person who sees the signs, and there is no protocol that fires immediately.
- County health officials have zero visibility into community-level mental-health signals until they escalate to acute incidents.
- The Kenya Mental Health Policy 2015–2030 recognizes community-level mental health as a critical gap, but there is no tool that turns frontline observations into structured intelligence + safe workflow.

The core tension: **the people closest to the need (CHVs) have no structured tool, and the people with the resources (county officials, facility staff) have no signal.**

## Proposed Solution

**Msaada** (Swahili for "help") is an AI-powered human-assistance coordination platform built for the CHV workflow. It is **not** an AI doctor, therapist, or diagnostic system. It is a **human coordination layer for AI**:

> *AI finds and structures the need. Deterministic policy controls safety. Authorized humans provide and verify the help.*

### The flow

```
CHV selects Household → Member → starts Encounter
    ↓
CHV speaks or types what they observed (English / Swahili / Sheng)
    ↓
PII scrubber redacts identifiers BEFORE the model sees them
    ↓
Qwen AI structures the observation (WHO-aligned triage flag)
    ↓
DETERMINISTIC POLICY ENGINE evaluates (separate from the AI — the model
can never override or downgrade a safety-critical signal)
    ↓
Policy decision → Referral + Follow-up (linked to the correct person)
    ↓
If crisis detected → non-dismissable crisis panel with Kenya Red Cross 1199
    ↓
Aggregate intelligence → county dashboard (de-identified)
```

### What makes it different

1. **The AI is not the authority.** Qwen produces structured *interpretation*. A separate, deterministic, versioned, auditable policy engine controls the *workflow decision*. The crisis-override logic is hardcoded — the model cannot downgrade it.

2. **Identity is preserved.** Every observation is linked through a full chain: Household → Member → Encounter → Observation → Policy Decision → Referral → Follow-up. Stable internal IDs (MSD-HH-XXXX, MSD-M-XXXX, etc.) — names are attributes, never primary keys. No referral is ever created without knowing which person it belongs to.

3. **Privacy is architectural.** The raw observation text is **never persisted**. A PII scrubber (8 Kenya-specific identifier types) runs before the model call. Dashboard reads are aggregate-only. Ownership is enforced at the data-access layer (the Supabase RLS equivalent). An audit trail logs every event with the policy version used.

4. **Safety is deterministic.** If the observation contains any indication of suicidal ideation, self-harm, or acute danger, a full-screen, non-dismissable crisis panel fires immediately — focus-trapped, refresh-guarded, 5-second countdown, clickable `tel:` links to Kenya Red Cross (1199) and Befrienders Kenya (+254 722 178 177).

5. **It meets CHVs where they are.** Natural-language capture in English, Swahili, Sheng, or mixed code-switching — no clinical forms. The CHV describes what they saw; the AI structures it.

## Current Progress

This is a **working hackathon MVP** — end-to-end functional, seeded with realistic synthetic data, demoed live. Built in ~15 review rounds across 30+ agent dispatches.

### ✅ What works (live, demo-able)

| Feature | Status |
|---|---|
| **CHV auth** (HMAC-signed session, scrypt-hashed) | ✅ |
| **Identity chain** — Household → Member → Encounter (stable IDs, data minimization) | ✅ |
| **Natural-language observation capture** (English/Swahili/Sheng sample transcripts) | ✅ |
| **PII scrubber** (8 Kenya-specific types: phones, emails, IDs, M-Pesa, plates, plots, schools, names) | ✅ |
| **Qwen AI triage** (structured JSON output, retry + fallback, never silently drops) | ✅ |
| **Deterministic policy engine** (v1.0.0, separate from AI, crisis override unmodifiable) | ✅ |
| **Non-dismissable crisis panel** (focus-trapped, tel: links, beforeunload guard, 5s countdown) | ✅ |
| **Referral lifecycle** (8 states: created → sent → acknowledged → in_progress → completed/declined/cancelled/expired) | ✅ |
| **Follow-up workflow** (pending → done/missed, 24h crisis / 48h standard, linked to referrals) | ✅ |
| **County aggregate dashboard** (Recharts, RBAC county-scope toggle, time-range filter, CSV export, freshness badge) | ✅ |
| **Compliance audit trail** (paginated, filterable, de-identified, policy-version logged) | ✅ |
| **Supervisor roster** (per-CHV de-identified activity/load/escalation burden) | ✅ |
| **CHV weekly report** (printable, de-identified personal stats) | ✅ |
| **6 defense layers** (never-persist → PII scrub → aggregate-only reads → ownership writes → audit trail → rate-limit) | ✅ |
| **Seed data** (4 households, 10 members, 9 encounters, 2 referrals — incl. 1 crisis) | ✅ |

### ⚠️ Production targets (documented, not in the MVP)

| Feature | Status | Note |
|---|---|---|
| Go backend (domain + application logic) | ☐ | Next.js is the web layer only in the target architecture |
| PostgreSQL + PostGIS (core data + geo) | ☐ | Sandbox uses Prisma + SQLite |
| NATS JetStream (async events) | ☐ | encounter.created, referral.acknowledged… |
| Temporal (durable workflows) | ☐ | Referral + follow-up + AI-processing workflows |
| Android CHW app (Kotlin, offline-first) | ☐ | Next.js is the web/management layer |
| Offline-first sync (local outbox + idempotency) | ☐ | The spec demands it; the MVP is online-only |
| Postgres RLS (row-level security at the DB) | ☐ | Sandbox enforces at the data-access layer |
| Compliance RBAC roles (CHV/Supervisor/County/Admin) | ☐ | Sandbox uses ownership-scoping + documented TODOs |
| Multi-channel (WhatsApp / SMS / USSD) | ☐ | |
| Security test suite (OWASP + prompt-injection) | ☐ | |
| Qwen evaluation dataset (multilingual + adversarial) | ☐ | |

### Routes (8, all live)

`/` (CHV submission, identity-gated) · `/households` (CHV workflow) · `/dashboard` (county aggregate) · `/audit` (compliance) · `/supervisor` (per-CHV roster) · `/referrals` (referral lifecycle) · `/report/mine` (CHV weekly report) · `/settings` (CHV profile + crisis-line reference)

### Quick start

```bash
bun install && bun run db:push && bun run dev   # http://localhost:3000
```

**Demo:** `demo@msaada.health` / `msaada123` (or click "Use demo account"). The dashboard auto-seeds if empty.

**Repo:** https://github.com/Roy-Wanyoike/msaada

---

## The 3-minute demo (for judges)

| Time | Action | What to show |
|---|---|---|
| 0:00 | Open `/` → **"Use demo account"** | Auto-login. Show **My Impact** card + **Pending Follow-ups**. |
| 0:20 | **Households** nav → open a household → **Start encounter** on a member | The identity chain: MSD-HH-XXXX → MSD-M-XXXX → MSD-ENC-XXXX. Deep-links to submission. |
| 0:40 | Pick the **⚠ CRISIS** sample → **Submit** | PII-scrubbed → Qwen → `escalation: true`. |
| 1:00 | **Crisis panel fires** | Non-dismissable, 5s countdown, `tel:1199` + `tel:+254722178177`. Focus-trapped. Refresh-guarded. |
| 1:20 | **Confirm** → show the **Referral** (MSD-REF-XXXX, emergency) | Policy engine created an emergency referral + 24h follow-up. |
| 1:40 | **Dashboard** nav | RBAC toggle (Kilifi/All), charts, follow-up completion KPI, freshness badge, audit strip. |
| 2:00 | **Audit** nav | Compliance trail — policy version + workflow class logged. De-identified. |
| 2:15 | **Supervisor** nav | Per-CHV roster. |
| 2:30 | **Referrals** nav | 8-state lifecycle. "Referral Created ≠ Help Received." |
| 2:45 | **My report** → **Print** | Printable weekly report. |
| 3:00 | Close: **"Msaada is a human coordination layer for AI, not an autonomous medical decision-maker."** | |

---

## The design decision judges ask about: AI ≠ Authority

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
  // NORMAL — deterministic mapping.
  switch (interpretation.classification) {
    case "routine":                 return { workflowClass: "routine", ... };
    case "needs_followup":          return { workflowClass: "follow_up_required", ... };
    case "needs_facility_referral": return { workflowClass: "referral_required", ... };
  }
}
```

Referral destinations come from an **authorized config** (`AUTHORIZED_DESTINATIONS`) — never invented by the AI (spec §12, §27).

## The 6 defense layers (de-identification)

| # | Layer | What it does |
|---|---|---|
| 1 | **Never persist the raw observation** | Sent to Qwen in-memory, discarded. No DB column. |
| 2 | **PII scrubber before the model** | 8 Kenya-specific identifier types redacted before Qwen sees the text. |
| 3 | **Aggregate-only dashboard reads** | groupBy queries that never select indicator text (Postgres VIEW equivalent). |
| 4 | **Ownership-scoped writes** | HMAC-signed session → `submittedById` enforced (RLS equivalent). |
| 5 | **Audit trail** | Every triage logged: who/when/where/verdict/policy-version/referral. Never observation text. |
| 6 | **Rate-limit per CHV** | 10 triage/60s per CHV + 3 seeds/10min per IP. Redis-swap-ready. |

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| Charts | Recharts (code-split via next/dynamic) |
| Database | Prisma + SQLite *(sandbox adaptation of Supabase)* |
| AI | Qwen via z-ai-web-dev-sdk (server-side only) |
| Auth | HMAC-signed cookie session (scrypt-hashed) |
| Policy | Deterministic policy engine (policy-engine.ts, v1.0.0) |

## The Qwen triage system prompt (fixed — crisis logic must not be modified)

> *You are Msaada, an AI triage-support tool for Community Health Volunteers (CHVs) in Kenya conducting routine household visits. You are NOT a diagnostic tool and NOT a therapist.*
>
> *CRISIS OVERRIDE (check first, always): If the observation contains any indication of suicidal ideation, expressed intent to self-harm, a means/plan mentioned, or acute danger to self or others, output ONLY:* `{"escalation": true, "chp_instruction": "Do not leave the household unaccompanied. Contact your CHV supervisor and the nearest Level 4+ facility immediately. If immediate danger, call Kenya Red Cross Emergency: 1199.", "crisis_line": "Kenya Red Cross Emergency: 1199 | Befrienders Kenya: +254 722 178 177", "record_for_reporting": true}`
>
> *Otherwise classify into exactly one of: routine, needs_followup, needs_facility_referral. Never diagnose. If information is too limited to classify confidently, default to needs_followup — under-triage is the higher-risk error.*

## Safety note

Msaada is **not** a diagnostic tool and **not** a therapist. It surfaces the Kenya Red Cross (1199) and Befrienders Kenya (+254 722 178 177) crisis lines. Reporting language says *"reported distress-related observations increased"* — never *"depression increased by 30%"* unless the methodology supports it.

**License:** MIT — hackathon MVP, not for clinical use without validation + compliance review + authorized Kenyan health-system integration.
