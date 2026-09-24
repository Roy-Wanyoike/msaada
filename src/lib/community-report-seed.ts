import { db } from "@/lib/db";
import { generateCode } from "@/lib/identity-types";

/**
 * Community Report seed (CR-011 supporting demo data).
 *
 * Creates 4 demo CommunityReports directly via Prisma — NO Qwen calls — so
 * the demo is fast (~ms) and reliable (no LLM parse failures). Each report
 * is pre-processed: the AI interpretation + deterministic policy decision
 * are hardcoded to match what the live Qwen + policy-engine pipeline would
 * produce for the given classification. This mirrors the shape stored by
 * `updateReportAI` + `updateReportPolicy` in community-report-store.
 *
 * Coverage (one of each major workflow class):
 *  1. routine               — workflowClass: routine               — no case
 *  2. needs_followup        — workflowClass: follow_up_required     — no case
 *  3. needs_facility_referral — workflowClass: referral_required    — ResponseCase (ready_for_assignment)
 *  4. crisis                 — workflowClass: crisis_override       — ResponseCase (ready_for_assignment)
 *
 * Per the CR-011-SEED task spec:
 *  - Each report's status is set to "triaged" (pre-processed).
 *  - For the crisis + needs_facility_referral reports, a ResponseCase is
 *    created with status="ready_for_assignment" (so the assignment flow
 *    can pick them up and trigger the CaseNotifications toast pipeline).
 *
 * Idempotency: each seed report uses a STABLE reportCode
 * (MSD-RPT-SEED-{1..4}). Before any insert, the function checks whether a
 * report with that exact code already exists; if so, the report (and its
 * case, if applicable) is left untouched. Re-running `seedCommunityReports`
 * therefore never duplicates rows — it's safe to call from /api/seed,
 * a page-onload hook, or a CLI.
 *
 * De-identification: the `description` strings below are ALREADY
 * PII-scrubbed (no real names, phone numbers, or addresses). They use
 * kinship labels (Mama/Baba/Mtoto) + coarse location only — same
 * convention as the existing triage seed transcripts. The raw concern
 * text is never persisted; only this pre-scrubbed form is stored.
 *
 * NO Qwen calls: this module deliberately avoids `classifyObservation`
 * so it can be used as a fast, hermetic demo seeder (e.g. on first
 * dashboard load) without burning LLM budget or risking parse-failure
 * fallbacks.
 */

// ---- Stable identifiers for idempotent seeding ----------------------------
// Hardcoded so re-runs match the existing row instead of minting a new
// code. The idempotency check looks for reports with reportCode in this
// list; the SEED_REPORT_CODE_PREFIX is exposed for callers that want to
// scrub all seed reports at once.
const SEED_REPORT_CODE_PREFIX = "MSD-RPT-SEED-";

const POLICY_VERSION = "1.0.0";
const AI_MODEL_VERSION = "qwen-seed-hardcoded:v1"; // not a real model — flag for audit

// ---- Seed spec ------------------------------------------------------------
interface SeedReportSpec {
  /** Stable code (idempotency key). */
  reportCode: string;
  /** PII-scrubbed concern text — what would be left AFTER pii-scrub. */
  description: string;
  /** mental_health | maternal | child_health | social_support | other */
  category: string;
  county: string;
  ward: string;
  landmark: string;
  /** Workflow class the live policy engine would produce. */
  workflowClass:
    | "routine"
    | "follow_up_required"
    | "referral_required"
    | "crisis_override";
  /** Hardcoded AI interpretation JSON (mirrors Qwen's structured output). */
  aiInterpretation: Record<string, unknown>;
  /** AI confidence 0.0-1.0. */
  aiConfidence: number;
  /** Hardcoded deterministic policy decision JSON. */
  policyDecision: Record<string, unknown>;
  /** Whether this report should produce a ResponseCase (crisis + facility). */
  createCase: boolean;
}

const SEED_REPORTS: SeedReportSpec[] = [
  // ---- 1. ROUTINE ---------------------------------------------------------
  {
    reportCode: `${SEED_REPORT_CODE_PREFIX}1`,
    description:
      "Mama amelala vizuri, anakula vizuri, hakuna wasiwasi. Ana shughuli zake za kila siku, mchangamfu, hana malalamiko yoyote.",
    category: "maternal",
    county: "Kilifi",
    ward: "Malindi Town",
    landmark: "karibu na soko",
    workflowClass: "routine",
    aiConfidence: 0.92,
    aiInterpretation: {
      escalation: false,
      classification: "routine",
      observed_indicators: [
        "sleeping well",
        "appetite normal",
        "no withdrawal",
        "mood stable",
      ],
      chp_next_action:
        "Continue routine home visits. No follow-up required unless condition changes.",
      confidence_note: null,
      aggregate_tag: "routine_wellbeing",
    },
    policyDecision: {
      policyVersion: POLICY_VERSION,
      workflowClass: "routine",
      isEscalation: false,
      referralPriority: null,
      referralCategory: null,
      followUpRequired: false,
      followUpDueHours: 48,
      reasoning:
        "Routine: no safety-critical signals detected. No referral or follow-up required.",
      confidenceDisposition: "accepted",
    },
    createCase: false,
  },

  // ---- 2. NEEDS FOLLOW-UP -------------------------------------------------
  {
    reportCode: `${SEED_REPORT_CODE_PREFIX}2`,
    description:
      "Baba amekuwa akijitenga na watu wiki mbili sasa, halali vizuri usiku, anaamka mapema sana. Halingi nje kama kawaida, anakaa ndani tu, hana appetite kubwa.",
    category: "mental_health",
    county: "Nairobi",
    ward: "Kibra",
    landmark: "karibu na kituo cha afya",
    workflowClass: "follow_up_required",
    aiConfidence: 0.78,
    aiInterpretation: {
      escalation: false,
      classification: "needs_followup",
      observed_indicators: [
        "social withdrawal (2 weeks)",
        "insomnia",
        "early morning waking",
        "reduced appetite",
      ],
      chp_next_action:
        "Revisit within 48h. Encourage gradual social contact. If symptoms worsen or self-harm ideation emerges, escalate immediately.",
      confidence_note:
        "Behavioral indicators are consistent but not severe enough for facility referral yet.",
      aggregate_tag: "social_withdrawal",
    },
    policyDecision: {
      policyVersion: POLICY_VERSION,
      workflowClass: "follow_up_required",
      isEscalation: false,
      referralPriority: null,
      referralCategory: null,
      followUpRequired: true,
      followUpDueHours: 48,
      reasoning:
        "Needs follow-up: behavioral indicators warrant a CHV revisit within 48h. " +
        "No facility referral unless condition worsens.",
      confidenceDisposition: "accepted",
    },
    createCase: false,
  },

  // ---- 3. NEEDS FACILITY REFERRAL ----------------------------------------
  {
    reportCode: `${SEED_REPORT_CODE_PREFIX}3`,
    description:
      "Mama hawezi kulala kabisa wiki mbili sasa, hafai chakula vizuri, analia mara kwa mara bila sababu, anaonekana mwenye kuchoka sana. Hana nguvu hata kusimama vizuri.",
    category: "mental_health",
    county: "Turkana",
    ward: "Loima",
    landmark: "karibu na sura ya kijiji",
    workflowClass: "referral_required",
    aiConfidence: 0.85,
    aiInterpretation: {
      escalation: false,
      classification: "needs_facility_referral",
      observed_indicators: [
        "severe insomnia (2 weeks)",
        "frequent unexplained crying",
        "significant weight/appetite loss",
        "marked fatigue",
        "possible low mood",
      ],
      chp_next_action:
        "Refer to nearest Level 4+ facility for clinical assessment. Accompany if possible. Revisit within 48h to confirm referral was acknowledged.",
      confidence_note:
        "Indicators meet the threshold for a facility-level mental health assessment.",
      aggregate_tag: "severe_distress",
    },
    policyDecision: {
      policyVersion: POLICY_VERSION,
      workflowClass: "referral_required",
      isEscalation: false,
      referralPriority: "urgent",
      referralCategory: "mental_health",
      followUpRequired: true,
      followUpDueHours: 48,
      reasoning:
        "Needs facility referral: indicators meet the threshold for a Level 4+ " +
        "facility assessment. Urgent referral created. Follow-up due in 48h to " +
        "confirm the referral was acknowledged.",
      confidenceDisposition: "accepted",
    },
    createCase: true,
  },

  // ---- 4. CRISIS OVERRIDE --------------------------------------------------
  // The description mirrors an unambiguous crisis signal (self-harm intent
  // + means) so the hardcoded AI interpretation can faithfully reproduce
  // the crisis_override path the live policy engine takes.
  {
    reportCode: `${SEED_REPORT_CODE_PREFIX}4`,
    description:
      "Mtoto amesema anaataka kujidhuru, amesema ataingia kwenye mto leo. Ameshanusha shingo yake na kujifunga kitu. Anasema hana sababu ya kuishi tena. Mtu wa jirani amebaki naye akiwaangalia ili asibaki peke yake.",
    category: "mental_health",
    county: "Kilifi",
    ward: "Kaloleni",
    landmark: "karibu na mto",
    workflowClass: "crisis_override",
    aiConfidence: 0.97,
    aiInterpretation: {
      escalation: true,
      chp_instruction:
        "Do not leave the household unaccompanied. Contact your CHV supervisor " +
        "and the nearest Level 4+ facility immediately. If immediate danger, " +
        "call Kenya Red Cross Emergency: 1199.",
      crisis_line:
        "Kenya Red Cross Emergency: 1199 | Befrienders Kenya: +254 722 178 177",
      record_for_reporting: true,
    },
    policyDecision: {
      policyVersion: POLICY_VERSION,
      workflowClass: "crisis_override",
      isEscalation: true,
      referralPriority: "emergency",
      referralCategory: "crisis_self_harm",
      followUpRequired: true,
      followUpDueHours: 24,
      reasoning:
        "Crisis override: model detected suicidal ideation / self-harm / acute danger. " +
        "Emergency referral created. CHV must not leave the household unaccompanied. " +
        "Crisis-line instruction issued. Follow-up due in 24h.",
      confidenceDisposition: "accepted",
    },
    createCase: true,
  },
];

export interface SeededReport {
  id: string;
  reportCode: string;
  workflowClass: string;
  category: string;
  county: string;
  ward: string;
  /** The ResponseCase id when one was created (crisis + facility). */
  caseId: string | null;
  caseCode: string | null;
  /** Whether this row was newly created on this call (false = pre-existing). */
  created: boolean;
}

export interface SeedCommunityReportsResult {
  chvId: string;
  reports: SeededReport[];
  createdCount: number;
  skippedCount: number;
}

/**
 * Idempotently creates 4 demo CommunityReports (and 2 ResponseCases) for
 * the given CHV. The CHV is recorded as the `assistedById` (an assisted
 * submission) so the demo data ties back to a real onboarding record.
 *
 * Safe to call repeatedly — re-runs hit the reportCode idempotency check
 * and return the pre-existing rows without re-creating.
 *
 * @param chvId  The CHV who "assisted" with these community submissions.
 *               Must reference an existing ChvUser row (the caller is
 *               responsible for ensuring the demo CHV exists — see
 *               /api/seed's `ensureDemoChv()`).
 */
export async function seedCommunityReports(
  chvId: string
): Promise<SeedCommunityReportsResult> {
  const out: SeededReport[] = [];
  let createdCount = 0;
  let skippedCount = 0;

  for (const spec of SEED_REPORTS) {
    // Idempotency: match by stable reportCode. If the report exists, do
    // not re-create it OR its ResponseCase — return what's there.
    const existing = await db.communityReport.findUnique({
      where: { reportCode: spec.reportCode },
    });

    if (existing) {
      skippedCount += 1;
      // Best-effort: surface the existing ResponseCase (if any) so the
      // caller can render the same shape as a fresh create.
      const existingCase = await db.responseCase.findFirst({
        where: { reportId: existing.id },
        select: { id: true, caseCode: true },
      });
      out.push({
        id: existing.id,
        reportCode: existing.reportCode,
        workflowClass: spec.workflowClass,
        category: existing.category,
        county: existing.county,
        ward: existing.ward ?? spec.ward,
        caseId: existingCase?.id ?? null,
        caseCode: existingCase?.caseCode ?? null,
        created: false,
      });
      continue;
    }

    // Create the report. status="triaged" per the CR-011-SEED spec
    // (pre-processed — AI + policy fields already populated).
    const report = await db.communityReport.create({
      data: {
        reportCode: spec.reportCode,
        reporterType: "assisted",
        assistedById: chvId,
        subjectType: "unidentified_person",
        description: spec.description,
        category: spec.category,
        county: spec.county,
        ward: spec.ward,
        landmark: spec.landmark,
        channel: "web",
        status: "triaged",
        aiInterpretation: JSON.stringify(spec.aiInterpretation),
        aiModelVersion: AI_MODEL_VERSION,
        aiConfidence: spec.aiConfidence,
        aiUncertainty: null,
        aiProcessedAt: new Date(),
        policyVersion: POLICY_VERSION,
        policyDecision: JSON.stringify(spec.policyDecision),
        policyWorkflowClass: spec.workflowClass,
      },
    });

    let caseId: string | null = null;
    let caseCode: string | null = null;

    // For the crisis + needs_facility_referral reports, also create a
    // ResponseCase (status="ready_for_assignment") so the assignment
    // flow can pick it up and the CaseNotifications component has
    // realistic data to surface toasts for once a CHV is assigned.
    if (spec.createCase) {
      const responseCase = await db.responseCase.create({
        data: {
          caseCode: generateCode("MSD-CASE"),
          reportId: report.id,
          status: "ready_for_assignment",
        },
      });
      caseId = responseCase.id;
      caseCode = responseCase.caseCode;
    }

    createdCount += 1;
    out.push({
      id: report.id,
      reportCode: report.reportCode,
      workflowClass: spec.workflowClass,
      category: report.category,
      county: report.county,
      ward: report.ward ?? spec.ward,
      caseId,
      caseCode,
      created: true,
    });

    // De-identified log line — no PII, no concern text.
    console.log(
      `[community-report-seed] created reportCode=${report.reportCode} ` +
        `workflowClass=${spec.workflowClass} county=${report.county} ` +
        `ward=${report.ward ?? "-"} caseCode=${caseCode ?? "-"}`
    );
  }

  return {
    chvId,
    reports: out,
    createdCount,
    skippedCount,
  };
}

/**
 * Count of seed reports currently in the DB (any status). Useful for a
 * "seed already run" guard in UI flows. Matches reports whose reportCode
 * starts with the stable seed prefix.
 */
export async function countSeedReports(): Promise<number> {
  try {
    const n = await db.communityReport.count({
      where: { reportCode: { startsWith: SEED_REPORT_CODE_PREFIX } },
    });
    return n;
  } catch {
    return 0;
  }
}

export default seedCommunityReports;
