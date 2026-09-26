import { db } from "@/lib/db";

/**
 * Hermetic demo-data seeder — populates the FULL identity chain so every
 * fresh deployment (local `npm run dev`, Vercel /tmp cold start) shows a
 * lived-in product instead of empty lists:
 *
 *   Organization → Community Health Unit
 *     → Household (×8, one inactive) → HouseholdMember (×14)
 *       → Encounter (×16, backdated 0…9d, mixed capture/connectivity)
 *         → TriageRecord (×16: routine / follow-up / referral / crisis;
 *            each carries the English next action AND its natural Kiswahili
 *            equivalent — chpNextActionSw — mirroring the bilingual output
 *            the live Qwen pipeline produces for every triage)
 *           → Referral (×5: completed / in_progress / acknowledged / sent / created)
 *           → FollowUp (×6: done / pending / missed)
 *         → AuditLog (one entry per seeded triage)
 *     → Invitation (×2: pending + accepted — admin onboarding demo)
 *     → AiActivity (×12, seeded once when the table is empty — impact meter)
 *
 * Design rules (mirrors community-report-seed.ts):
 *  - NO Qwen calls: triage outputs are hardcoded to exactly what the live
 *    pipeline (classifyObservation + evaluatePolicy v1.0.0) would produce,
 *    so seeding is fast (~ms) and cannot fail on LLM parse errors.
 *  - IDEMPOTENT by stable codes: households/members/encounters use
 *    MSD-*-SEED-N codes (@unique); the triage for each encounter is keyed
 *    by the encounter (one triage per encounter in the seed); follow-ups
 *    are keyed by triageRecordId. Re-running never duplicates.
 *    UPGRADE IN PLACE: triage rows seeded before MVP-39 (chpNextActionSw
 *    still null, aiModel = seed model) are backfilled with their Kiswahili
 *    action on the next run — already-deployed databases upgrade without
 *    a reset, and live-pipeline rows are never touched.
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
  invitationsCreated: number;
  aiActivitiesCreated: number;
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
  /** Natural Kiswahili equivalent of chpNextAction — what the live Qwen
   *  pipeline returns as chp_next_action_sw for every triage. */
  chpNextActionSw?: string | null;
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
    // Lifecycle states the seed exercises (subset of the model's full
    // created|sent|acknowledged|in_progress|completed|declined|cancelled|expired).
    status: "created" | "sent" | "acknowledged" | "in_progress" | "completed";
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
  { code: "MSD-HH-SEED-1", label: "Household 12 · Shella", ward: "Malindi Town", status: "active" },
  { code: "MSD-HH-SEED-2", label: "Household 27 · Kizingoni", ward: "Malindi Town", status: "active" },
  { code: "MSD-HH-SEED-3", label: "Household 8 · Maweni", ward: "Malindi Town", status: "active" },
  { code: "MSD-HH-SEED-4", label: "Household 31 · Scorpion", ward: "Malindi Town", status: "active" },
  { code: "MSD-HH-SEED-5", label: "Household 19 · Shella", ward: "Malindi Town", status: "active" },
  { code: "MSD-HH-SEED-6", label: "Household 44 · Kizingoni", ward: "Malindi Town", status: "active" },
  { code: "MSD-HH-SEED-7", label: "Household 7 · Maweni", ward: "Malindi Town", status: "active" },
  // One inactive household exercises the roster's inactive state + filters.
  { code: "MSD-HH-SEED-8", label: "Household 52 · Scorpion (relocated)", ward: "Malindi Town", status: "inactive" },
] as const;

// ---- Members (kinship labels, never names — data minimization) ------------
const MEMBERS = [
  { code: "MSD-M-SEED-1", hh: 0, displayName: "Mama", role: "mother", ageBand: "25-49" },
  { code: "MSD-M-SEED-2", hh: 0, displayName: "Mtoto — age 6", role: "child", ageBand: "5-14" },
  { code: "MSD-M-SEED-3", hh: 1, displayName: "Baba", role: "father", ageBand: "25-49" },
  { code: "MSD-M-SEED-4", hh: 1, displayName: "Bibi", role: "grandparent", ageBand: "50+" },
  { code: "MSD-M-SEED-5", hh: 2, displayName: "Mama", role: "mother", ageBand: "25-49" },
  { code: "MSD-M-SEED-6", hh: 3, displayName: "Mtoto — age 3", role: "child", ageBand: "<5" },
  { code: "MSD-M-SEED-7", hh: 4, displayName: "Mama", role: "mother", ageBand: "25-49" },
  { code: "MSD-M-SEED-8", hh: 4, displayName: "Mtoto — age 11", role: "child", ageBand: "5-14" },
  { code: "MSD-M-SEED-9", hh: 5, displayName: "Baba", role: "father", ageBand: "50+" },
  { code: "MSD-M-SEED-10", hh: 5, displayName: "Mama", role: "mother", ageBand: "25-49" },
  { code: "MSD-M-SEED-11", hh: 6, displayName: "Kijana — age 17", role: "other", ageBand: "15-24" },
  { code: "MSD-M-SEED-12", hh: 6, displayName: "Bibi", role: "grandparent", ageBand: "50+" },
  { code: "MSD-M-SEED-13", hh: 7, displayName: "Baba", role: "father", ageBand: "25-49" },
  { code: "MSD-M-SEED-14", hh: 7, displayName: "Mtoto — age 9", role: "child", ageBand: "5-14" },
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
    chpNextActionSw:
      "Mpe rufaa kwenda hospitali ya karibu ya Level 4+ kupimwa. Rudi tena kuhakikisha amefika na ameanzishiwa huduma.",
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
    chpNextActionSw:
      "Endelea na ziara za kawaida za nyumbani. Hakuna ufuatiliaji maalum isipokuwa hali yake itabadilika.",
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
    chpNextActionSw:
      "Rudi ndani ya saa 48. Mhimize kuwasiliana na watu taratibu. Iwapo mawazo ya kujidhuru yatajitokeza, ripoti mara moja.",
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
    chpNextActionSw: "Endelea kufuatilia afya ya mtoto kwa ratiba ya kawaida ya eCHIS.",
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
    chpNextActionSw:
      "Usiache nyumba hii bila mtu ukiwa naye. Wasiliana na simanzi wako na hospitali ya karibu ya Level 4+ mara moja.",
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

  // ---- Extended roster visits (10 more, 14-day window) ---------------------
  // Routine-heavy mix so the county dashboard daily chart shows a realistic
  // baseline with occasional spikes; every workflow class + referral state
  // gets at least one representative.
  {
    encounterCode: "MSD-ENC-SEED-6",
    householdIndex: 4,
    memberIndex: 6,
    daysAgo: 8,
    captureMethod: "text",
    connectivity: "online",
    classification: "routine",
    observedIndicators: ["mood stable", "sleeping well", "adherence good"],
    aggregateTag: "routine_wellbeing",
    chpNextAction: "Continue routine monthly visits.",
    chpNextActionSw: "Endelea na ziara za kila mwezi kama kawaida.",
    confidenceNote: null as unknown as string,
    workflowClass: "routine",
  },
  {
    encounterCode: "MSD-ENC-SEED-7",
    householdIndex: 5,
    memberIndex: 8,
    daysAgo: 7,
    captureMethod: "voice",
    connectivity: "offline",
    classification: "routine",
    observedIndicators: ["managing well", "socializing again", "appetite back"],
    aggregateTag: "routine_recovery",
    chpNextAction: "Sync when connectivity returns; no action needed.",
    chpNextActionSw: "Sawazisha data mara mtandao unaporejea; hakuna hatua nyingine inayohitajika.",
    confidenceNote: null as unknown as string,
    workflowClass: "routine",
  },
  {
    encounterCode: "MSD-ENC-SEED-8",
    householdIndex: 1,
    memberIndex: 2,
    daysAgo: 6,
    captureMethod: "mixed",
    connectivity: "intermittent",
    classification: "needs_followup",
    observedIndicators: ["sleep disruption returning", "mild withdrawal"],
    aggregateTag: "early_relapse_signals",
    chpNextAction: "Revisit within 48h to confirm the trend before escalating.",
    chpNextActionSw: "Rudi ndani ya saa 48 kuhakiki hali inavyoendelea kabla ya kuchukua hatua nyingine.",
    confidenceNote: "Early signals — below referral threshold but above routine.",
    workflowClass: "follow_up_required",
    followUp: {
      status: "done",
      dueDaysAgo: 5,
      resolvedDaysAgo: 5,
      resolutionNote: "Revisited: sleeping better, back to normal routine.",
    },
  },
  {
    encounterCode: "MSD-ENC-SEED-9",
    householdIndex: 6,
    memberIndex: 10,
    daysAgo: 5,
    captureMethod: "text",
    connectivity: "online",
    classification: "routine",
    observedIndicators: ["school attendance steady", "no reported concerns"],
    aggregateTag: "adolescent_routine",
    chpNextAction: "Continue routine monitoring.",
    chpNextActionSw: "Endelea kumfuatilia kama kawaida.",
    confidenceNote: null as unknown as string,
    workflowClass: "routine",
  },
  {
    encounterCode: "MSD-ENC-SEED-10",
    householdIndex: 2,
    memberIndex: 4,
    daysAgo: 4,
    captureMethod: "voice",
    connectivity: "online",
    classification: "needs_facility_referral",
    observedIndicators: [
      "persistent anxiety symptoms (3 weeks)",
      "unable to attend work",
      "panic episodes described",
    ],
    aggregateTag: "anxiety_functional_impairment",
    chpNextAction: "Refer for clinical assessment; accompany to facility intake.",
    chpNextActionSw: "Mpe rufaa apimwe kliniki; msindikize hadi hospitalini aanze kupokea huduma.",
    confidenceNote: "Functional impairment meets facility-referral threshold.",
    workflowClass: "referral_required",
    referral: {
      code: "MSD-REF-SEED-3",
      category: "mental_health",
      priority: "urgent",
      destination: "Malindi Sub-County Hospital",
      status: "acknowledged",
    },
  },
  {
    encounterCode: "MSD-ENC-SEED-11",
    householdIndex: 0,
    memberIndex: 0,
    daysAgo: 3,
    captureMethod: "text",
    connectivity: "online",
    classification: "routine",
    observedIndicators: ["recovering well", "no medication complaints"],
    aggregateTag: "post_referral_recovery",
    chpNextAction: "Routine follow-up only.",
    chpNextActionSw: "Ufuatiliaji wa kawaida tu.",
    confidenceNote: null as unknown as string,
    workflowClass: "routine",
  },
  {
    encounterCode: "MSD-ENC-SEED-12",
    householdIndex: 7,
    memberIndex: 13,
    daysAgo: 2,
    captureMethod: "mixed",
    connectivity: "offline",
    classification: "needs_followup",
    observedIndicators: ["night terrors reported", "declining school performance"],
    aggregateTag: "child_distress_signals",
    chpNextAction: "Revisit within 48h; engage guardian on sleep hygiene.",
    chpNextActionSw: "Rudi ndani ya saa 48; zungumza na mlezi kuhusu mtindo wa usingizi mzima.",
    confidenceNote: "Child indicators need one more data point before routing.",
    workflowClass: "follow_up_required",
    followUp: {
      status: "missed",
      dueDaysAgo: 1,
      resolvedDaysAgo: 0,
      resolutionNote: "Household away (relocated relative) — retry scheduled.",
    },
  },
  {
    encounterCode: "MSD-ENC-SEED-13",
    householdIndex: 6,
    memberIndex: 11,
    daysAgo: 2,
    captureMethod: "text",
    connectivity: "intermittent",
    classification: "routine",
    observedIndicators: ["mobility stable", "carer support consistent"],
    aggregateTag: "elderly_routine",
    chpNextAction: "Continue welfare visits per eCHIS schedule.",
    chpNextActionSw: "Endelea na ziara za ustawi kwa ratiba ya eCHIS.",
    confidenceNote: null as unknown as string,
    workflowClass: "routine",
  },
  {
    encounterCode: "MSD-ENC-SEED-14",
    householdIndex: 5,
    memberIndex: 9,
    daysAgo: 1,
    captureMethod: "voice",
    connectivity: "online",
    classification: "needs_facility_referral",
    observedIndicators: [
      "postpartum low mood (4 weeks)",
      "difficulty bonding with infant",
      "sleep deprivation beyond newborn norm",
    ],
    aggregateTag: "postpartum_mental_health",
    chpNextAction: "Refer to maternal mental health program; revisit in 48h.",
    chpNextActionSw: "Munganishe na programu ya afya ya akili kwa mama; rudi ndani ya saa 48.",
    confidenceNote: "Postpartum indicators meet referral threshold (policy v1.0.0).",
    workflowClass: "referral_required",
    referral: {
      code: "MSD-REF-SEED-4",
      category: "maternal",
      priority: "urgent",
      destination: "Kilifi County Referral Hospital",
      status: "sent",
    },
    followUp: {
      status: "pending",
      dueHoursFromNow: 40,
    },
  },
  {
    encounterCode: "MSD-ENC-SEED-15",
    householdIndex: 3,
    memberIndex: 5,
    daysAgo: 0,
    captureMethod: "text",
    connectivity: "online",
    classification: "routine",
    observedIndicators: ["stabilizing on treatment", "guardian engaged", "attending school half-days"],
    aggregateTag: "crisis_aftercare",
    chpNextAction: "Aftercare: keep weekly visits; escalation line stays open.",
    chpNextActionSw: "Uhudumu baada ya rufaa: endelea na ziara za kila wiki; mawasiliano ya dharura yako wazi.",
    confidenceNote: null as unknown as string,
    workflowClass: "routine",
  },
  {
    // A referral freshly created and not yet sent — exercises the very
    // start of the 8-state referral lifecycle (the state every UI-created
    // referral begins in).
    encounterCode: "MSD-ENC-SEED-16",
    householdIndex: 4,
    memberIndex: 7,
    daysAgo: 0,
    captureMethod: "text",
    connectivity: "online",
    classification: "needs_facility_referral",
    observedIndicators: [
      "acute distress on waking",
      "refusing food and drink today",
      "guardian requesting facility care",
    ],
    aggregateTag: "acute_child_distress",
    chpNextAction: "Complete referral to the county facility; confirm transport.",
    chpNextActionSw: "Kamilisha rufaa kwenda hospitali ya kaunti; hakikisha usafiri umepangwa.",
    confidenceNote: "Acute presentation — referral created, dispatch pending.",
    workflowClass: "referral_required",
    referral: {
      code: "MSD-REF-SEED-5",
      category: "child_health",
      priority: "urgent",
      destination: "Malindi Sub-County Hospital",
      status: "created",
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
    invitationsCreated: 0,
    aiActivitiesCreated: 0,
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

  // Attach the demo admin to the org too (mirrors the CHV attach above,
  // issue #45). Invitations are created with the INVITER's organizationId —
  // an org-less admin would send org-null invitations, and accepted invitees
  // would get county=null (default-deny RBAC → they can see nothing).
  if (adminId) {
    const adminRow = await db.chvUser.findUnique({
      where: { id: adminId },
      select: { organizationId: true },
    });
    if (adminRow && adminRow.organizationId !== organizationId) {
      await db.chvUser.update({
        where: { id: adminId },
        data: { organizationId },
      });
    }
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
        status: hh.status,
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
      select: { id: true, aiModel: true, chpNextActionSw: true },
    });

    let triageRecordId = existingTriage?.id;
    if (
      existingTriage &&
      existingTriage.aiModel === AI_MODEL &&
      !existingTriage.chpNextActionSw &&
      v.chpNextActionSw
    ) {
      // MVP-39 in-place upgrade: databases seeded before the Kiswahili
      // actions existed get backfilled on the next bootstrap run. Guarded
      // by the seed model string + null field → idempotent (no duplicate
      // writes) and never touches rows produced by the live pipeline.
      await db.triageRecord.update({
        where: { id: existingTriage.id },
        data: { chpNextActionSw: v.chpNextActionSw },
      });
    }
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
          chpNextActionSw: v.chpNextActionSw ?? null,
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
            acknowledgedBy: ["acknowledged", "in_progress", "completed"].includes(
              v.referral.status
            )
              ? v.referral.status === "completed"
                ? "Malindi Sub-County Hospital"
                : "Kilifi County Referral Hospital"
              : null,
            acknowledgedAt: ["acknowledged", "in_progress", "completed"].includes(
              v.referral.status
            )
              ? v.referral.status === "completed"
                ? daysAgo(v.daysAgo - 0.2)
                : v.daysAgo === 0
                  ? hoursFromNow(-2)
                  : daysAgo(v.daysAgo - 0.2)
              : null,
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
          // MVP-44 org/authz columns: seeded rows belong to the demo org
          // and the CHV role (nullable columns — old rows stay valid).
          organizationId: organizationId ?? null,
          authorizationRole: "chv",
        },
      });
      result.auditLogsCreated += 1;
    }
  }

  // ---- Invitations (admin onboarding demo data) ----------------------------
  // Two rows so the /admin onboarding view has both states: a pending invite
  // the admin can act on, and an accepted one showing the happy path.
  // Idempotent by stable token (the token column is @unique).
  const INVITATIONS = [
    {
      token: "MSD-INV-SEED-1",
      email: "chv.candidate@msaada.health",
      fullName: "CHV Candidate (Demo)",
      status: "pending",
      expiresAt: hoursFromNow(7 * 24),
      acceptedAt: null as Date | null,
    },
    {
      token: "MSD-INV-SEED-2",
      email: "chv.joined@msaada.health",
      fullName: "CHV Joined (Demo)",
      status: "accepted",
      expiresAt: daysAgo(20),
      acceptedAt: daysAgo(21) as Date | null,
    },
  ];
  if (adminId) {
    for (const inv of INVITATIONS) {
      const existing = await db.invitation.findUnique({
        where: { token: inv.token },
        select: { id: true },
      });
      if (existing) continue;
      await db.invitation.create({
        data: {
          token: inv.token,
          email: inv.email,
          fullName: inv.fullName,
          role: "chv",
          organizationId,
          invitedById: adminId,
          status: inv.status,
          expiresAt: inv.expiresAt,
          acceptedAt: inv.acceptedAt,
          createdAt: daysAgo(22),
        },
      });
      result.invitationsCreated += 1;
    }
  }

  // ---- AiActivity (the "Qwen at work" impact meter) -------------------------
  // The impact card reads AiActivity; without rows it renders empty on every
  // fresh demo. Seed a small synthetic history ONCE (guarded by an empty-table
  // check — never appended to on re-runs, never mixed with real rows). The
  // model string is the flagged non-real seed model so provenance stays
  // honest: this is demo data, not actual API traffic. Metadata only — the
  // table never stores prompts, observation text or outputs.
  const existingAi = await db.aiActivity.findFirst({ select: { id: true } });
  if (!existingAi) {
    const AI_TASKS: Array<{ task: string; ok: boolean; latencyMs: number; errorKind?: string; daysAgo: number; hour: number }> = [
      { task: "triage", ok: true, latencyMs: 1420, daysAgo: 9, hour: 3 },
      { task: "triage", ok: true, latencyMs: 1180, daysAgo: 8, hour: 5 },
      { task: "report_intake", ok: true, latencyMs: 990, daysAgo: 8, hour: 8 },
      { task: "privacy_scan", ok: true, latencyMs: 240, daysAgo: 7, hour: 4 },
      { task: "triage", ok: true, latencyMs: 1670, daysAgo: 7, hour: 6 },
      { task: "dashboard_summary", ok: true, latencyMs: 2100, daysAgo: 6, hour: 7 },
      { task: "transcribe", ok: true, latencyMs: 3120, daysAgo: 5, hour: 2 },
      { task: "triage", ok: false, latencyMs: 15000, errorKind: "timeout", daysAgo: 4, hour: 5 },
      { task: "assignment", ok: true, latencyMs: 860, daysAgo: 4, hour: 9 },
      { task: "referral_handover", ok: true, latencyMs: 1340, daysAgo: 2, hour: 6 },
      { task: "followup_questions", ok: true, latencyMs: 1120, daysAgo: 1, hour: 4 },
      { task: "triage", ok: true, latencyMs: 1250, daysAgo: 0, hour: 2 },
    ];
    for (const a of AI_TASKS) {
      await db.aiActivity.create({
        data: {
          createdAt: daysAgo(a.daysAgo, a.hour),
          task: a.task,
          model: AI_MODEL,
          ok: a.ok,
          latencyMs: a.latencyMs,
          errorKind: a.errorKind ?? null,
        },
      });
      result.aiActivitiesCreated += 1;
    }
  }

  return result;
}

export default seedDemoData;
