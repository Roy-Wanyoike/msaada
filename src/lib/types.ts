// Shared types for the Msaada triage flow.

export const COUNTIES = ["Kilifi", "Nairobi", "Turkana", "Mombasa"] as const;
export type County = (typeof COUNTIES)[number];

export const WARDS: Record<County, string[]> = {
  Kilifi: ["Malindi Town", "Magarini", "Ganze", "Kaloleni"],
  Nairobi: ["Kibra", "Mathare", "Mukuru", "Kasarani"],
  Turkana: ["Turkana Central", "Loima", "Turkana North", "Turkana South"],
  Mombasa: ["Mvita", "Likoni", "Kisauni", "Changamwe"],
};

export type Classification =
  | "routine"
  | "needs_followup"
  | "needs_facility_referral";

export const CLASSIFICATIONS: Classification[] = [
  "routine",
  "needs_followup",
  "needs_facility_referral",
];

/** Shape returned by Qwen (crisis override path). */
export interface CrisisResult {
  escalation: true;
  chp_instruction: string;
  crisis_line: string;
  record_for_reporting: boolean;
}

/** Shape returned by Qwen (normal classification path). */
export interface NormalResult {
  escalation: false;
  classification: Classification;
  observed_indicators: string[];
  chp_next_action: string;
  confidence_note: string | null;
  aggregate_tag: string;
  /** Qwen's plain-language reason for the classification (optional). */
  reasoning?: string | null;
  /** chp_next_action in Kiswahili (optional). */
  chp_next_action_sw?: string | null;
}

export type TriageModelOutput = CrisisResult | NormalResult;

/**
 * What the /api/triage route persists + returns to the client.
 * The raw observation text is intentionally NOT present here.
 */
export interface TriageRecordDTO {
  id: string;
  createdAt: string;
  county: string;
  ward: string | null;
  classification: Classification;
  escalation: boolean;
  observedIndicators: string[];
  aggregateTag: string | null;
  chpNextAction: string | null;
  chpInstruction: string | null;
  crisisLine: string | null;
  confidenceNote: string | null;
  fallbackUsed: boolean;
  /** Links to the Encounter that generated this observation (section 6, 15). */
  encounterId: string | null;
  /** Qwen's explanation of the classification (null on fallback / crisis). */
  aiReasoning: string | null;
  /** Next action in Kiswahili (null on fallback / crisis). */
  chpNextActionSw: string | null;
  /** Model that produced the verdict, or "fallback"; null on legacy rows. */
  aiModel: string | null;
}

/** Payload the client sends to /api/triage. */
export interface TriageRequest {
  observation_text: string;
  county: string;
  ward?: string;
  /** Optional encounter ID — links the observation to the identity chain (§6,§15). */
  encounterId?: string;
}
