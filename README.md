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
| Offline-first sync + Android app | ☐ Production target |
| NATS JetStream + Temporal workflows | ☐ Production target |

---

## Quick Start

```bash
bun install && bun run db:push && bun run dev   # http://localhost:3000
```

**Demo accounts:**
- CHV: `demo@msaada.health` / `msaada123`
- County Admin: `county.admin@msaada.health` / `msaada123`

**Tech Stack:** Next.js 16 (App Router, TypeScript) + Qwen (via z-ai-web-dev-sdk) + Prisma + Tailwind CSS 4 + shadcn/ui + Recharts

**GitHub:** https://github.com/Roy-Wanyoike/msaada

---

## License

MIT — hackathon MVP, not for clinical use without validation + compliance review + authorized Kenyan health-system integration.
