# Work Record — p2d-seed

- **Task ID:** p2d-seed
- **Agent:** seed-updater
- **Scope:** `src/app/api/seed/route.ts` ONLY (single-file update).

## Context reviewed

- `/home/z/my-project/worklog.md` (architecture + prior review rounds)
- `/home/z/my-project/src/app/api/seed/route.ts` (target file — original only seeded TriageRecords via Qwen)
- `/home/z/my-project/src/lib/triage-store.ts` (confirmed `insertTriageRecord` already accepts optional `encounterId`)
- `/home/z/my-project/src/lib/policy-engine.ts` (`evaluatePolicy` + `getDestinationForCategory` + `ModelInterpretation`)
- `/home/z/my-project/src/lib/identity-types.ts` (`generateCode(prefix)` helper)
- `/home/z/my-project/src/app/api/triage/route.ts` (reference implementation of the full identity-chain + policy flow — mirrored for the seed path)
- `/home/z/my-project/prisma/schema.prisma` (Household, HouseholdMember, Encounter, Referral models + relation fields)

## Changes made to `src/app/api/seed/route.ts`

### 1. New imports

Added three new imports for the identity chain + policy engine:

```ts
import { generateCode } from "@/lib/identity-types";
import {
  evaluatePolicy,
  getDestinationForCategory,
  type ModelInterpretation,
} from "@/lib/policy-engine";
import type { County } from "@/lib/types";
```

### 2. `HOUSEHOLDS` spec (new constant)

4 demo households — one per county — each with 2-3 members using kinship
labels (Mama/Baba/Bibi/Mtoto — age N) instead of names. Labels are mnemonics
like "Household 1, Malindi" — never PII. Each member carries a role
(mother/father/child/grandparent) and ageBand (<5 | 5-14 | 25-49 | 50+) per
the data-minimization rules in §3.

### 3. `ensureHouseholds()` (new helper)

Idempotently creates the 4 demo households + their members. Households are
matched by `(chwId + label)`; members by `(householdId + displayName)`.
On a hit, the existing row is reused; on a miss, a new row is created with
`householdCode: generateCode("MSD-HH")` / `memberCode: generateCode("MSD-M")`
(per task instructions). Codes are stable across re-runs because the
existing-row check fires before the create.

### 4. `pickHouseholdAndMember()` (new helper)

Picks the household from the same county as the transcript, cycling through
the household's members via a per-county cursor so multiple transcripts in
the same county land on different members when the household has >1.

### 5. `toInterpretation()` (new helper)

Projects the Qwen output into the `ModelInterpretation` shape expected by
`evaluatePolicy`. Mirrors the same projection used in `/api/triage` so the
policy engine sees the same interpretation shape regardless of whether the
record came from the live API or the seed flow (crisis override triggers
`escalation=true` + `classification="needs_facility_referral"` +
`aggregateTag="crisis_self_harm"`).

### 6. Transcript loop rewritten

Per transcript, the loop now:

1. Picks a household + member from the same county (cursor-rotated).
2. Creates a completed `Encounter` (status "completed", captureMethod
   "text", connectivity "online", startedAt/completedAt backdated to the
   same day as the triage record).
3. Calls `classifyObservation(t.text)` (unchanged).
4. Calls `insertTriageRecord({...})` WITH `encounterId: encounter.id`
   (new field — the orchestrator's Phase 1 work already accepts it).
5. Backdates the triage record (unchanged).
6. Runs `evaluatePolicy(interpretation)` to get the deterministic policy
   decision (policyVersion, workflowClass, referralPriority,
   referralCategory, followUpRequired).
7. If `workflowClass === "referral_required" || "crisis_override"` AND
   `referralPriority && referralCategory` are both set, creates a
   `Referral` linked to `encounter.id + household.id + member.id`, with
   `referralCode: generateCode("MSD-REF")`, category/priority from the
   policy decision, destination from `getDestinationForCategory`,
   `createdById/createdBy = demoChv.id`, `followUpRequired` from the
   policy.
8. Pushes a richer record summary (now includes `encounterId`,
   `householdId`, `memberId`, `workflowClass`) onto the response.

### 7. Response shape expanded

The JSON response now also returns:

```jsonc
{
  "seeded": 9,
  "records": [...],            // existing, now with encounterId/householdId/memberId/workflowClass
  "referrals": [...],          // NEW — list of referrals created by the policy engine
  "households": [...]          // NEW — id/county/label/memberCount summary
}
```

## Untouched logic (per task constraint)

- `checkRateLimit("seed:" + ip)` 3/10min token bucket — unchanged.
- `ensureDemoChv()` cookie-session demo CHV — unchanged.
- `backdateRecord()` raw-SQL `UPDATE TriageRecord SET createdAt` — unchanged.
- The 9-entry `TRANSCRIPTS` array (text + county + ward + dayOffset) —
  unchanged, only consumed differently (each is now attached to an
  encounter + household + member before being passed to Qwen).
- De-identification: transcript text is still processed in-memory only;
  only model-derived structured output + the encounter/household/member
  IDs are persisted.

## Idempotency matrix

| Entity         | Idempotent by                       | Notes                                                       |
|----------------|-------------------------------------|-------------------------------------------------------------|
| ChvUser        | email                               | Existing `ensureDemoChv`.                                   |
| Household      | (chwId, label)                      | Code regenerated only on first create.                      |
| HouseholdMember| (householdId, displayName)          | Code regenerated only on first create.                      |
| Encounter      | NOT idempotent                      | Fresh row per seed call (rate-limited).                      |
| TriageRecord   | NOT idempotent                     | Fresh row per seed call (rate-limited).                      |
| Referral       | NOT idempotent                      | Fresh row per seed call, only when the policy says so.       |

## Expected referrals after a fresh seed run

The 9 transcripts → policy-engine decisions:
- 4 routine → no referral.
- 3 needs_followup → `follow_up_required` (no referral).
- 1 needs_facility_referral → `referral_required` (urgent,
  `mental_health`) → 1 Referral.
- 1 crisis → `crisis_override` (emergency, `crisis_self_harm`) → 1
  Referral (the demo CHV's crisis-line instruction is also reflected in
  the stored TriageRecord's `chpInstruction`/`crisisLine` columns).

Net: 2 referrals per seed run, both visible on the dashboard Referrals list.

## Verification

- `bun run lint` → PASS (exit 0, no errors, no warnings).
- Dev server log checked: no compile/runtime errors after edit; existing
  `/api/triage` activity continues to work.

## Stage Summary

- Seed data now demonstrates the full identity chain: Household →
  HouseholdMember → Encounter → TriageRecord → Referral.
- Referrals are populated on the dashboard (was previously empty because
  the seed path bypassed the policy engine + the referral-creation step).
- The 4 demo households + 9 demo members are stable across seed runs;
  codes are regenerated only on first creation.
- The 9 transcripts are now each linked to a county-matched household +
  member, so the Encounters list + Referrals list show realistic
  identity-chain rows rather than dangling unlinked triage records.
