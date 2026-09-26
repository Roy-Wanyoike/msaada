import { parseJsonObject, qwenChat, qwenConfigured, stringList } from "@/lib/ai/client";

/**
 * Qwen helpers for case and referral handling. All advisory:
 *  - structureCaseOutcome: free-text resolution note → outcome category
 *  - suggestAssignment:    which CHV should take a case (supervisor confirms)
 *  - draftReferralHandover: facility handover note from structured data
 * None of them decides routing; the policy engine and humans still do.
 */

// ---------------------------------------------------------------------------
// Case outcome
// ---------------------------------------------------------------------------

export const CASE_OUTCOMES = [
  "reached_doing_well",
  "reached_needs_support",
  "referred_to_facility",
  "not_reached",
  "other",
] as const;
export type CaseOutcomeCategory = (typeof CASE_OUTCOMES)[number];

export interface CaseOutcome {
  category: CaseOutcomeCategory;
  summary: string;
}

const OUTCOME_PROMPT = `A Community Health Volunteer in Kenya closed a case and wrote a short resolution note (Kiswahili, Sheng or English; personal details already removed). Classify the outcome.

Categories:
- reached_doing_well: person was reached and is OK / improving
- reached_needs_support: person was reached but still needs support or another visit
- referred_to_facility: person was referred or taken to a health facility
- not_reached: person could not be found or reached
- other: none of the above

Respond with a single JSON object only:
{"category": "<one category>", "summary": "one short plain-English sentence describing the outcome, no names"}`;

export async function structureCaseOutcome(note: string): Promise<CaseOutcome | null> {
  if (!qwenConfigured() || !note.trim()) return null;
  try {
    const { content } = await qwenChat({
      task: "case_outcome",
      messages: [
        { role: "system", content: OUTCOME_PROMPT },
        { role: "user", content: note },
      ],
      json: true,
      temperature: 0,
      maxTokens: 200,
      timeoutMs: 10_000,
    });
    const obj = parseJsonObject(content);
    const category = obj?.category;
    if (typeof category !== "string" || !(CASE_OUTCOMES as readonly string[]).includes(category)) {
      return null;
    }
    const summary = typeof obj?.summary === "string" ? obj.summary.trim().slice(0, 300) : "";
    return { category: category as CaseOutcomeCategory, summary };
  } catch (err) {
    console.error("[qwen] case outcome failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Assignment suggestion
// ---------------------------------------------------------------------------

export interface AssignmentCandidate {
  id: string;
  /** Short label shown to the model and the supervisor (never an email). */
  label: string;
  ward: string | null;
  openCases: number;
  submissionsLast7d: number;
}

export interface AssignmentCase {
  category: string;
  county: string;
  ward: string | null;
  landmark: string | null;
  urgency: string | null;
  summary: string | null;
}

export interface AssignmentSuggestion {
  chvId: string;
  label: string;
  reason: string;
  /** "qwen", or "rule" when the model didn't answer usefully. */
  source: "qwen" | "rule";
  model: string | null;
}

const ASSIGN_PROMPT = `You help a Kenyan community-health supervisor choose which Community Health Volunteer (CHV) should respond to a community report. You get the case and a list of eligible CHVs in the same county. A supervisor will confirm your choice.

Prefer, in order: a CHV in the same ward as the case; a CHV with fewer open cases; a CHV who has been active recently. For high-urgency cases, weigh proximity (same ward) most.

Respond with a single JSON object only:
{"chv_id": "<id from the list>", "reason": "one short sentence a supervisor can read, e.g. 'Same ward (Malindi Town) and only 1 open case.'"}`;

/** Deterministic fallback: same ward first, then fewest open cases, then most active. */
function ruleBasedPick(c: AssignmentCase, candidates: AssignmentCandidate[]): AssignmentSuggestion {
  const ranked = [...candidates].sort(
    (a, b) =>
      Number(b.ward === c.ward) - Number(a.ward === c.ward) ||
      a.openCases - b.openCases ||
      b.submissionsLast7d - a.submissionsLast7d
  );
  const pick = ranked[0];
  const sameWard = pick.ward && pick.ward === c.ward;
  return {
    chvId: pick.id,
    label: pick.label,
    reason: `${sameWard ? `Same ward (${pick.ward})` : "Nearest available in the county"}, ${pick.openCases} open case${pick.openCases === 1 ? "" : "s"}.`,
    source: "rule",
    model: null,
  };
}

export async function suggestAssignment(
  c: AssignmentCase,
  candidates: AssignmentCandidate[]
): Promise<AssignmentSuggestion | null> {
  if (candidates.length === 0) return null;
  if (!qwenConfigured()) return ruleBasedPick(c, candidates);
  try {
    const { content, model } = await qwenChat({
      task: "assignment",
      messages: [
        { role: "system", content: ASSIGN_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            case: c,
            eligible_chvs: candidates.map((x) => ({
              chv_id: x.id,
              label: x.label,
              ward: x.ward,
              open_cases: x.openCases,
              submissions_last_7_days: x.submissionsLast7d,
            })),
          }),
        },
      ],
      json: true,
      temperature: 0,
      maxTokens: 200,
      timeoutMs: 12_000,
    });
    const obj = parseJsonObject(content);
    const picked = candidates.find((x) => x.id === obj?.chv_id);
    const reason = typeof obj?.reason === "string" ? obj.reason.trim().slice(0, 300) : "";
    // The model may only pick from the eligible list; otherwise use the rule.
    if (!picked || !reason) return ruleBasedPick(c, candidates);
    return { chvId: picked.id, label: picked.label, reason, source: "qwen", model };
  } catch (err) {
    console.error("[qwen] assignment suggestion failed:", err instanceof Error ? err.message : err);
    return ruleBasedPick(c, candidates);
  }
}

// ---------------------------------------------------------------------------
// Referral handover note
// ---------------------------------------------------------------------------

export interface HandoverInput {
  referralCode: string;
  category: string;
  priority: string;
  destination: string | null;
  createdAt: string;
  classification: string | null;
  escalation: boolean;
  observedIndicators: string[];
  chpNextAction: string | null;
  reasoning: string | null;
}

export interface HandoverNote {
  note: string;
  keyPoints: string[];
  model: string;
}

const HANDOVER_PROMPT = `You draft short handover notes from a Community Health Volunteer (CHV) in Kenya to the health facility receiving a referral. You get the structured result of the CHV's visit (no names, no free text).

Write for a nurse or clinical officer: plain English, factual, 3-5 sentences. State the referral category and priority, the behaviours the CHV observed, and what the CHV has already advised. Never diagnose or use clinical labels; say "observed" not "has". If it is a crisis escalation, say so in the first sentence.

Respond with a single JSON object only:
{"note": "the handover note", "key_points": ["up to 4 short bullet points for quick reading"]}`;

export async function draftReferralHandover(input: HandoverInput): Promise<HandoverNote | null> {
  if (!qwenConfigured()) return null;
  try {
    const { content, model } = await qwenChat({
      task: "referral_handover",
      messages: [
        { role: "system", content: HANDOVER_PROMPT },
        { role: "user", content: JSON.stringify(input) },
      ],
      json: true,
      temperature: 0.2,
      maxTokens: 500,
    });
    const obj = parseJsonObject(content);
    const note = typeof obj?.note === "string" ? obj.note.trim().slice(0, 1500) : "";
    if (!note) return null;
    return { note, keyPoints: stringList(obj?.key_points, 4), model };
  } catch (err) {
    console.error("[qwen] referral handover failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
