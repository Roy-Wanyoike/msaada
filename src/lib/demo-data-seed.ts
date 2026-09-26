import { db } from "@/lib/db";

/**
 * Hermetic demo-data seeder — populates the FULL identity chain so every
 * fresh deployment (local `npm run dev`, Vercel /tmp cold start) shows a
 * lived-in product instead of empty lists:
 *
 *   Organization → Community Health Unit
 *     → Household (×4) → HouseholdMember (×6)
 *       → Encounter (×5, backdated 9d…today, mixed capture/connectivity)
 *         → TriageRecord (×5: routine / follow-up / referral / crisis)
 *           → Referral (×2: completed, in_progress)
 *           → FollowUp (×3: done, pending×2)
 *         → AuditLog (one entry per seeded triage)
 *
 * Design rules (mirrors community-report-seed.ts):
 *  - NO Qwen calls: triage outputs are hardcoded to exactly what the live
 *    pipeline (classifyObservation + evaluatePolicy v1.0.0) would produce,
 *    so seeding is fast (~ms) and cannot fail on LLM parse errors.
 *  - IDEMPOTENT by stable codes: households/members/encounters use
 *    MSD-*-SEED-N codes (@unique); the triage for each encounter is keyed
 *    by the encounter (one triage per encounter in the seed); follow-ups
 *    are keyed by triageRecordId. Re-running never duplicates.
 *  - DE-IDENTIFIED: kinship labels only (Mama/Baba/Bibi/Mtoto), coarse
 *    wards, no names/phones/addresses — same convention as every seed in
 *    this codebase. The "transcripts" below are in-memory only; only the
 *    structured model output is persisted.
 *  - Backdated across the last 10 days so the county dashboard daily chart
 *    shows a realistic trend, not a single today-spike.
 */

const POLICY_VERSION = "1.0.0";
const AI_MODEL = "qwen-seed-hardcoded:v1"; // not a real model — flagged for audit
const PROMPT_VERSION = "1.0.0";

function daysAgo(days: number, extraHours = 0): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 + extraHours * 3600 * 1000);
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3600 * 1000);
}

export interface DemoDataSeedResult {
  organizationCreated: boolean;
  healthUnitCreated: boolean;
  householdsCreated: number;
  membersCreated: number;
  encountersCreated: number;
  triageRecordsCreated: number;
  referralsCreated: number;
  followUpsCreated: number;
  auditLogsCreated: number;
  skippedCount: number;
}

/** One seeded visit: encounter + its triage verdict + downstream actions. */
interface VisitSpec {
  encounterCode: string;
  householdIndex: number; // 0-based index into HOUSEHOLDS
  memberIndex: number; // 0-based index into MEMBERS
  daysAgo: number;
  captureMethod: "text" | "voice" | "mixed";
  connectivity: "online" | "offline" | "intermittent";
  classification: "routine" | "needs_followup" | "needs_facility_referral";
  escalation?: boolean;
  observedIndicators: string[];
  aggregateTag: string;
  chpNextAction: string;
  confidenceNote: string;
  workflowClass:
    | "routine"
    | "follow_up_required"
    | "referral_required"
    | "crisis_override";
  referral?: {
    code: string;
    category: string;
    priority: "routine" | "urgent" | "emergency";
    destination: string;
    status: "acknowledged" | "in_progress" | "completed";
  };
  followUp?: {
    status: "pending" | "done" | "missed";
    dueHoursFromNow?: number;
    dueDaysAgo?: number;
    resolvedDaysAgo?: number;
    resolutionNote?: string;
  };
}

// ---- Households (Kilifi · Malindi Town — the demo CHV's catchment) --------
const HOUSEHOLDS = [
  { code: "MSD-HH-SEED-1", label: "Household 12 · Shella", ward: "Malindi Town" },
  { code: "MSD-HH-SEED-2", label: "Household 27 · Kizingoni", ward: "Malindi Town" },
  { code: "MSD-HH-SEED-3", label: "Household 8 · Maweni", ward: "Malindi Town" },
  { code: "MSD-HH-SEED-4", label: "Household 31 · Scorpion", ward: "Malindi Town" },
] as const;

// ---- Members (kinship labels, never names — data minimization) ------------
const MEMBERS = [
  { code: "MSD-M-SEED-1", hh: 0, displayName: "Mama", role: "mother", ageBand: "25-49" },
  { code: "MSD-M-SEED-2", hh: 0, displayName: "Mtoto — age 6", role: "child", ageBand: "5-14" },
  { code: "MSD-M-SEED-3", hh: 1, displayName: "Baba", role: "father", ageBand: "25-49" },
  { code: "MSD-M-SEED-4", hh: 1, displayName: "Bibi", role: "grandparent", ageBand: "50+" },
  { code: "MSD-M-SEED-5", hh: 2, displayName: "Mama", role: "mother", ageBand: "25-49" },
  { code: "MSD-M-SEED-6", hh: 3, displayName: "Mtoto — age 3", role: "child", ageBand: "<5" },
] as const;

// ---- Visit specs (5 encounters, one triage verdict each) -------------------
const VISITS: VisitSpec[] = [
  {
    encounterCode: "MSD-ENC-SEED-1",
    householdIndex: 0,
    memberIndex: 0,
    daysAgo: 9,
    captureMethod: "text",
    connectivity: "online",
    classification: "needs_facility_referral",
    observedIndicators: [
      "severe insomnia (2 weeks)",
      "frequent unexplained crying",
      "significant appetite loss",
      "marked fatigue",
    ],
    aggregateTag: "severe_distress",
    chpNextAction:
      "Refer to nearest Level 4+ facility for clinical assessment. Revisit to confirm acknowledgement.",
    confidenceNote:
      "Indicators meet the threshold for a facility-level mental health assessment.",
    workflowClass: "referral_required",
    referral: {
      code: "MSD-REF-SEED-1",
      category: "mental_health",
      priority: "urgent",
      destination: "Malindi Sub-County Hospital",
      status: "completed",
    },
    followUp: {
      status: "done",
      dueDaysAgo: 7,
      resolvedDaysAgo: 6,
      resolutionNote: "Revisited — mother attended facility assessment; condition improving.",
    },
  },
  {
    encounterCode: "MSD-ENC-SEED-2",
    householdIndex: 1,
    memberIndex: 2,
    daysAgo: 7,
    captureMethod: "voice",
    connectivity: "offline", // drafted offline, synced later — offline-first demo
    classification: "routine",
    observedIndicators: ["sleeping well", "appetite normal", "mood stable", "socially active"],
    aggregateTag: "routine_wellbeing",
    chpNextAction: "Continue routine home visits. No follow-up required unless condition changes.",
    confidenceNote: null as unknown as string,
    workflowClass: "routine",
  },
  {
    encounterCode: "MSD-ENC-SEED-3",
    householdIndex: 2,
    memberIndex: 4,
    daysAgo: 4,
    captureMethod: "text",
    connectivity: "intermittent",
    classification: "needs_followup",
    observedIndicators: [
      "social withdrawal (2 weeks)",
      "insomnia",
      "early morning waking",
      "reduced appetite",
    ],
    aggregateTag: "social_withdrawal",
    chpNextAction:
      "Revisit within 48h. Encourage gradual social contact. Escalate immediately if self-harm ideation emerges.",
    confidenceNote:
      "Behavioral indicators are consistent but not severe enough for facility referral yet.",
    workflowClass: "follow_up_required",
    followUp: {
      status: "pending",
      dueHoursFromNow: 36,
    },
  },
  {
    encounterCode: "MSD-ENC-SEED-4",
    householdIndex: 0,
    memberIndex: 1,
    daysAgo: 2,
    captureMethod: "mixed",
    connectivity: "online",
    classification: "routine",
    observedIndicators: ["playing normally", "appetite normal", "sleeping well", "no fever"],
    aggregateTag: "child_health_routine",
    chpNextAction: "Continue routine child-health monitoring per eCHIS schedule.",
    confidenceNote: null as unknown as string,
    workflowClass: "routine",
  },
  {
    // Crisis visit — exercises the crisis_override path end-to-end with the
    // same deterministic outputs the live pipeline produces.
    encounterCode: "MSD-ENC-SEED-5",
    householdIndex: 3,
    memberIndex: 5,
    daysAgo: 0,
    captureMethod: "voice",
    connectivity: "online",
    classification: "needs_facility_referral",
    escalation: true,
    observedIndicators: [
      "expressed self-harm intent",
      "stated plan (nearby river)",
      "guardian informed — household not left unaccompanied",
    ],
    aggregateTag: "crisis_self_harm",
    chpNextAction:
      "Do not leave the household unaccompanied. Contact supervisor and nearest Level 4+ facility immediately.",
    confidenceNote: "Unambiguous crisis signals — policy crisis_override applied.",
    workflowClass: "crisis_override",
    referral: {
      code: "MSD-REF-SEED-2",
      category: "crisis_self_harm",
      priority: "emergency",
      destination: "Kilifi County Referral Hospital",
      status: "in_progress",
    },
    followUp: {
      status: "pending",
      dueHoursFromNow: 24,
    },
  },
];

/**
 * Idempotently seed the full demo identity chain for the given CHV.
 * @param chvId   the demo CHV (owns households, submits triages)
 * @param adminId the demo county admin (supervises the seeded CHU)
 */
export async function seedDemoData(
  chvId: string,
  adminId?: string
): Promise<DemoDataSeedResult> {
  const result: DemoDataSeedResult = {
    organizationCreated: false,
    healthUnitCreated: false,
    householdsCreated: 0,
    membersCreated: 0,
    encountersCreated: 0,
    triageRecordsCreated: 0,
    referralsCreated: 0,
    followUpsCreated: 0,
    auditLogsCreated: 0,
    skippedCount: 0,
  };

  // ---- Organization + CHU (institution-led hierarchy §1, §5) --------------
  let organizationId: string | undefined;
  const org = await db.organization.findFirst({
    where: { name: "Kilifi County Department of Health", type: "county_department" },
    select: { id: true },
  });
  if (org) {
    organizationId = org.id;
  } else {
    const created = await db.organization.create({
      data: {
        name: "Kilifi County Department of Health",
        type: "county_department",
        county: "Kilifi",
      },
      select: { id: true },
    });
    organizationId = created.id;
    result.organizationCreated = true;
  }

  const chu = await db.communityHealthUnit.findFirst({
    where: { name: "Malindi Town Community Health Unit", county: "Kilifi" },
    select: { id: true },
  });
  if (!chu) {
    await db.communityHealthUnit.create({
      data: {
        name: "Malindi Town Community Health Unit",
        county: "Kilifi",
        subCounty: "Malindi",
        ward: "Malindi Town",
        organizationId,
        supervisorId: adminId ?? null,
      },
    });
    result.healthUnitCreated = true;
  }

  // Attach the demo CHV to the org (idempotent — only writes when different).
  const chvRow = await db.chvUser.findUnique({
    where: { id: chvId },
    select: { organizationId: true },
  });
  if (chvRow && chvRow.organizationId !== organizationId) {
    await db.chvUser.update({ where: { id: chvId }, data: { organizationId } });
  }

  // ---- Households ---------------------------------------------------------
  const householdIds: string[] = [];
  for (const hh of HOUSEHOLDS) {
    const existing = await db.household.findUnique({
      where: { householdCode: hh.code },
      select: { id: true },
    });
    if (existing) {
      householdIds.push(existing.id);
      result.skippedCount += 1;
      continue;
    }
    const created = await db.household.create({
      data: {
        householdCode: hh.code,
        chwId: chvId,
        county: "Kilifi",
        ward: hh.ward,
        label: hh.label,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(30),
      },
      select: { id: true },
    });
    householdIds.push(created.id);
    result.householdsCreated += 1;
  }

  // ---- Members --------------------------------------------------------------
  const memberIds: string[] = [];
  for (const m of MEMBERS) {
    const existing = await db.householdMember.findUnique({
      where: { memberCode: m.code },
      select: { id: true },
    });
    if (existing) {
      memberIds.push(existing.id);
      result.skippedCount += 1;
      continue;
    }
    const created = await db.householdMember.create({
      data: {
        memberCode: m.code,
        householdId: householdIds[m.hh],
        displayName: m.displayName,
        role: m.role,
        ageBand: m.ageBand,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(30),
      },
      select: { id: true },
    });
    memberIds.push(created.id);
    result.membersCreated += 1;
  }

  // ---- Visits: Encounter → TriageRecord → Referral → FollowUp → AuditLog ---
  for (const v of VISITS) {
    const when = daysAgo(v.daysAgo);

    let encounterId: string;
    const existingEnc = await db.encounter.findUnique({
      where: { encounterCode: v.encounterCode },
      select: { id: true },
    });
    if (existingEnc) {
      encounterId = existingEnc.id;
      result.skippedCount += 1;
    } else {
      const enc = await db.encounter.create({
        data: {
          encounterCode: v.encounterCode,
          householdId: householdIds[v.householdIndex],
          memberId: memberIds[v.memberIndex],
          chwId: chvId,
          status: "completed",
          captureMethod: v.captureMethod,
          connectivity: v.connectivity,
          startedAt: when,
          completedAt: new Date(when.getTime() + 40 * 60 * 1000),
          createdAt: when,
          updatedAt: when,
        },
        select: { id: true },
      });
      encounterId = enc.id;
      result.encountersCreated += 1;
    }

    // One triage per seeded encounter (idempotency key for the record).
    const existingTriage = await db.triageRecord.findFirst({
      where: { encounterId },
      select: { id: true },
    });

    let triageRecordId = existingTriage?.id;
    if (!triageRecordId) {
      const triage = await db.triageRecord.create({
        data: {
          createdAt: when,
          county: "Kilifi",
          ward: "Malindi Town",
          classification: v.classification,
          escalation: v.escalation ?? false,
          fallbackUsed: false,
          observedIndicators: JSON.stringify(v.observedIndicators),
          aggregateTag: v.aggregateTag,
          chpNextAction: v.chpNextAction,
          chpInstruction: v.escalation
            ? "Do not leave the household unaccompanied. Contact your CHV supervisor and the nearest Level 4+ facility immediately. If immediate danger, call Kenya Red Cross Emergency: 1199."
            : null,
          crisisLine: v.escalation
            ? "Kenya Red Cross Emergency: 1199 | Befrienders Kenya: +254 722 178 177"
            : null,
          confidenceNote: v.confidenceNote ?? null,
          aiModel: AI_MODEL,
          promptVersion: PROMPT_VERSION,
          submittedById: chvId,
          encounterId,
        },
        select: { id: true },
      });
      triageRecordId = triage.id;
      result.triageRecordsCreated += 1;
    }

    // Referral — idempotent BY ITS OWN CODE (not by "triage was created this
    // run"): if a crash ever lands between the triage write and the referral
    // write, the next bootstrap run back-fills the referral instead of
    // permanently skipping it.
    let referralId: string | null = null;
    if (v.referral) {
      const existingRef = await db.referral.findUnique({
        where: { referralCode: v.referral.code },
        select: { id: true },
      });
      if (existingRef) {
        referralId = existingRef.id;
      } else {
        const ref = await db.referral.create({
          data: {
            referralCode: v.referral.code,
            encounterId,
            householdId: householdIds[v.householdIndex],
            memberId: memberIds[v.memberIndex],
            category: v.referral.category,
            priority: v.referral.priority,
            destination: v.referral.destination,
            status: v.referral.status,
            createdBy: "Demo CHV",
            createdById: chvId,
            createdAt: when,
            acknowledgedBy:
              v.referral.status === "completed"
                ? "Malindi Sub-County Hospital"
                : "Kilifi County Referral Hospital",
            acknowledgedAt:
              v.referral.status === "completed"
                ? daysAgo(v.daysAgo - 0.2)
                : v.daysAgo === 0
                  ? hoursFromNow(-2)
                  : daysAgo(v.daysAgo - 0.2),
            completedAt:
              v.referral.status === "completed" ? daysAgo(v.daysAgo - 3) : null,
            followUpRequired: true,
          },
          select: { id: true },
        });
        referralId = ref.id;
        result.referralsCreated += 1;
      }
    }

    // Follow-up — idempotent BY TRIAGE (max one per triage by design).
    if (v.followUp) {
      const existingFu = await db.followUp.findFirst({
        where: { triageRecordId: triageRecordId! },
        select: { id: true },
      });
      if (!existingFu) {
        const dueAt = v.followUp.dueHoursFromNow
          ? hoursFromNow(v.followUp.dueHoursFromNow)
          : daysAgo(v.followUp.dueDaysAgo ?? 1);
        await db.followUp.create({
          data: {
            createdAt: when,
            dueAt,
            status: v.followUp.status,
            resolvedAt:
              v.followUp.resolvedDaysAgo != null
                ? daysAgo(v.followUp.resolvedDaysAgo)
                : null,
            resolutionNote: v.followUp.resolutionNote ?? null,
            triageRecordId: triageRecordId!,
            chvId,
            referralId,
          },
        });
        result.followUpsCreated += 1;
      }
    }

    // Audit trail — idempotent BY (triage, event) so a crash mid-seed also
    // back-fills the audit entry on the next run.
    const auditEvent = v.escalation ? "crisis_override" : "triage_classified";
    const existingAudit = await db.auditLog.findFirst({
      where: { triageRecordId: triageRecordId!, event: auditEvent },
      select: { id: true },
    });
    if (!existingAudit) {
      await db.auditLog.create({
        data: {
          createdAt: when,
          triageRecordId,
          actorId: chvId,
          event: auditEvent,
          county: "Kilifi",
          ward: "Malindi Town",
          classification: v.classification,
          escalation: v.escalation ?? false,
          fallbackUsed: false,
          piiRedactions: JSON.stringify({ phone: 0, email: 0, id: 0, name: 0 }),
          policyVersion: POLICY_VERSION,
          aiModel: AI_MODEL,
          workflowClass: v.workflowClass,
          referralId,
        },
      });
      result.auditLogsCreated += 1;
    }
  }

  return result;
}

export default seedDemoData;
