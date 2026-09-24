/**
 * Deterministic Policy Engine (§10, §12)
 *
 * The AI (Qwen) produces a structured INTERPRETATION. This policy engine
 * is a separate, deterministic, versioned, auditable layer that controls
 * the WORKFLOW DECISION — what action to take. The AI can NEVER override
 * or downgrade a safety-critical signal (§10).
 *
 * Architecture:
 *   Qwen → Interpretation (structured observation)
 *     → Policy Engine (THIS) → Workflow classification + referral/follow-up
 *     → Authorized human/system action
 *
 * The policy is:
 *  - explicit (rules are code, not prose in a prompt)
 *  - versioned (policyVersion recorded per evaluation)
 *  - auditable (every decision is logged)
 *  - testable (pure function, no side effects)
 *  - deterministic (same input → same output, every time)
 *  - independently deployable from the model
 */

export const POLICY_VERSION = "1.0.0";

/** The model's structured interpretation (what Qwen returned). */
export interface ModelInterpretation {
  escalation: boolean;
  classification: "routine" | "needs_followup" | "needs_facility_referral";
  observedIndicators: string[];
  aggregateTag: string | null;
  chpNextAction: string | null;
  chpInstruction: string | null;
  crisisLine: string | null;
  confidenceNote: string | null;
  /** Whether the spec fallback was used (Qwen parse failure). */
  fallbackUsed: boolean;
}

/** The deterministic policy decision. */
export interface PolicyDecision {
  /** The policy version that produced this decision. */
  policyVersion: string;
  /** The workflow classification (what action to take). */
  workflowClass:
    | "routine"
    | "follow_up_required"
    | "referral_required"
    | "human_review"
    | "crisis_override";
  /** Whether this is a safety-critical escalation. */
  isEscalation: boolean;
  /** Referral priority (if a referral is created). */
  referralPriority: "routine" | "urgent" | "emergency" | null;
  /** Referral category (from authorized config, not invented — §27). */
  referralCategory: string | null;
  /** Whether a follow-up is required. */
  followUpRequired: boolean;
  /** Follow-up due-in hours (the spec's "revisit within 48h"). */
  followUpDueHours: number;
  /** Human-readable explanation of WHY this decision was made (auditable). */
  reasoning: string;
  /** Confidence disposition (§11). */
  confidenceDisposition: "accepted" | "low_confidence" | "human_review";
}

/**
 * Evaluate the model's interpretation against the deterministic policy.
 *
 * CRISIS OVERRIDE (§10, §12): if the model returned escalation=true, the
 * policy ALWAYS confirms the crisis workflow — the AI cannot downgrade this.
 * This is the highest-priority rule and fires first.
 *
 * FALLBACK (§11): if the model output could not be parsed (fallbackUsed=true),
 * the policy defaults to CAUTION — follow_up_required + human_review — never
 * routine. Under-triage is the higher-risk error.
 *
 * Otherwise the policy maps the classification to a workflow:
 *  - routine → routine (no referral/follow-up)
 *  - needs_followup → follow_up_required (48h)
 *  - needs_facility_referral → referral_required (urgent, 48h follow-up)
 *
 * This function is PURE — no side effects, no DB, no I/O. It's testable +
 * deterministic. The caller persists the decision.
 */
export function evaluatePolicy(
  interpretation: ModelInterpretation
): PolicyDecision {
  const base = {
    policyVersion: POLICY_VERSION,
    isEscalation: false,
    referralPriority: null as PolicyDecision["referralPriority"],
    referralCategory: null,
    followUpRequired: false,
    followUpDueHours: 48,
    reasoning: "",
    confidenceDisposition: "accepted" as const,
  };

  // ---- CRISIS OVERRIDE (highest priority — §10) ----
  // The AI cannot override or downgrade this. If escalation=true, the
  // crisis workflow fires unconditionally.
  if (interpretation.escalation) {
    return {
      ...base,
      workflowClass: "crisis_override",
      isEscalation: true,
      referralPriority: "emergency",
      referralCategory: "crisis_self_harm",
      followUpRequired: true,
      followUpDueHours: 24, // crisis follow-ups due sooner — 24h
      reasoning:
        "Crisis override: model detected suicidal ideation / self-harm / acute danger. " +
        "Emergency referral created. CHV must not leave the household unaccompanied. " +
        "Crisis-line instruction issued. Follow-up due in 24h.",
      confidenceDisposition: "accepted",
    };
  }

  // ---- FALLBACK (§11 — never silently drop, default to caution) ----
  if (interpretation.fallbackUsed) {
    return {
      ...base,
      workflowClass: "human_review",
      followUpRequired: true,
      followUpDueHours: 48,
      reasoning:
        "Model output could not be parsed. Policy defaults to caution: " +
        "follow_up_required + human_review. Under-triage is the higher-risk error.",
      confidenceDisposition: "human_review",
    };
  }

  // ---- NORMAL CLASSIFICATION (deterministic mapping) ----
  switch (interpretation.classification) {
    case "routine":
      return {
        ...base,
        workflowClass: "routine",
        followUpRequired: false,
        reasoning:
          "Routine: no safety-critical signals detected. No referral or follow-up required.",
      };

    case "needs_followup":
      return {
        ...base,
        workflowClass: "follow_up_required",
        followUpRequired: true,
        followUpDueHours: 48,
        reasoning:
          "Needs follow-up: behavioral indicators warrant a CHV revisit within 48h. " +
          "No facility referral unless condition worsens.",
      };

    case "needs_facility_referral":
      return {
        ...base,
        workflowClass: "referral_required",
        referralPriority: "urgent",
        referralCategory: "mental_health",
        followUpRequired: true,
        followUpDueHours: 48,
        reasoning:
          "Needs facility referral: indicators meet the threshold for a Level 4+ " +
          "facility assessment. Urgent referral created. Follow-up due in 48h to " +
          "confirm the referral was acknowledged.",
      };

    default:
      // Unknown classification — safest default is caution.
      return {
        ...base,
        workflowClass: "human_review",
        followUpRequired: true,
        reasoning:
          "Unknown classification. Policy defaults to caution: human_review + follow_up.",
        confidenceDisposition: "human_review",
      };
  }
}

/**
 * Authorized referral destinations (§12, §27 — NOT invented by the AI).
 * In production these come from program configuration; here they're a
 * static config clearly labeled as demo data.
 */
export const AUTHORIZED_DESTINATIONS = [
  {
    id: "level4-facility",
    label: "Nearest Level 4+ facility (county hospital)",
    categories: ["mental_health", "maternal", "child_health", "crisis_self_harm"],
  },
  {
    id: "chw-supervisor",
    label: "CHV Supervisor (sub-county)",
    categories: ["mental_health", "social_support"],
  },
  {
    id: "red-cross-emergency",
    label: "Kenya Red Cross Emergency (1199)",
    categories: ["crisis_self_harm"],
  },
] as const;

/** Returns the authorized destination for a referral category. */
export function getDestinationForCategory(
  category: string
): string | null {
  const match = AUTHORIZED_DESTINATIONS.find((d) =>
    d.categories.includes(category as never)
  );
  return match ? match.label : null;
}
