import { parseJsonObject, qwenChat, qwenConfigured, stringList } from "@/lib/ai/client";

/**
 * Case-level supervisor summary (issue #55, task "case_summary").
 *
 * Builds a SHORT advisory narrative for a supervisor opening a response
 * case: recurring themes across the linked encounters, the latest triage
 * verdict, and outstanding actions (open follow-ups, pending lifecycle
 * steps). The prompt is constructed ONLY from already-authorized structured
 * fields — report category/status, structured indicators, classifications,
 * next actions, follow-up states. Raw observation text is never stored and
 * therefore never sent; no names, no free text.
 *
 * Human-in-the-loop: the caller (POST /api/response-cases/[id]/summary)
 * marks the response `advisory: true` and the UI renders an explicit
 * "AI-generated, advisory only — verify with the CHV" banner. The summary
 * NEVER changes case state, routing or any decision.
 *
 * Fails soft: model chain down / not configured → a deterministic bullet
 * summary built from the same structured fields with fallbackUsed=true.
 * Never throws for a model outage.
 */

export const CASE_SUMMARY_PROMPT_VERSION = "case-summary-v1";

/** Hard cap — the narrative must stay a short, readable advisory. */
export const CASE_SUMMARY_MAX_WORDS = 180;

export interface CaseSummaryEncounter {
  /** ISO date of the encounter/triage. */
  date: string;
  classification: string;
  escalation: boolean;
  /** Structured indicators observed (already de-identified). */
  indicators: string[];
  /** Aggregate tag (e.g. sleep_disturbance). */
  aggregateTag: string | null;
  chpNextAction: string | null;
  /** Missing-information items captured at triage time (issue #55). */
  missingInformation: string[];
}

export interface CaseSummaryFollowUp {
  status: string;
  dueAt: string;
  resolvedAt: string | null;
}

export interface CaseSummaryInput {
  caseCode: string;
  category: string;
  caseStatus: string;
  county: string;
  ward: string | null;
  policyWorkflowClass: string | null;
  assigned: boolean;
  accepted: boolean;
  attended: boolean;
  resolved: boolean;
  outcomeCategory: string | null;
  encounters: CaseSummaryEncounter[];
  followUps: CaseSummaryFollowUp[];
}

export interface CaseSummary {
  /** Short advisory narrative (≤ 180 words). */
  narrative: string;
  /** Recurring themes, short labels. */
  themes: string[];
  /** Outstanding actions the supervisor/CHV still owes. */
  outstandingActions: string[];
}

export interface CaseSummaryResult {
  summary: CaseSummary;
  /** True when the deterministic fallback produced the summary. */
  fallbackUsed: boolean;
  /** Model that produced the summary, or "fallback". */
  model: string;
  promptVersion: string;
}

const SYSTEM_PROMPT = `You write a short advisory case summary for a Kenyan community-health supervisor reviewing one response case. You receive STRUCTURED fields only: report category and lifecycle status, per-visit classifications, observed behavioural indicators (de-identified), next actions, follow-up states and outcome category. No free text, no names.

Rules:
- Plain English, factual, supportive. At most 180 words.
- Cover: recurring themes across visits, the LATEST verdict, and what is still outstanding (open follow-ups, unfinished lifecycle steps).
- Use only the fields provided. Never invent figures, causes or clinical labels. Never speculate about individuals.
- This summary is ADVISORY — it must never read as a decision or a diagnosis.

Respond with a single JSON object only:
{"narrative": "the short advisory narrative (<= 180 words)", "themes": ["up to 4 short theme labels"], "outstanding_actions": ["up to 4 short bullets"]}`;

/** Cap a narrative to the word budget without cutting mid-word. */
function capWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ") + " …";
}

/** One plain bullet describing an outstanding item, or null when none. */
function outstandingFromState(input: CaseSummaryInput): string[] {
  const items: string[] = [];
  const openFollowUps = input.followUps.filter((f) => f.status === "pending");
  if (openFollowUps.length > 0) {
    items.push(
      `${openFollowUps.length} follow-up${openFollowUps.length === 1 ? "" : "s"} still pending`
    );
  }
  if (!input.assigned) items.push("case not yet assigned to a CHV");
  else if (!input.accepted) items.push("assignment not yet accepted by the CHV");
  else if (!input.attended && !input.resolved) items.push("home visit not yet attended");
  else if (input.attended && !input.resolved) items.push("case not yet resolved");
  if (input.encounters.length > 0) {
    const latest = input.encounters[0];
    for (const m of latest.missingInformation.slice(0, 2)) {
      items.push(`confirm ${m} on next contact`);
    }
  }
  return items.slice(0, 4);
}

/**
 * Deterministic bullet summary from the SAME structured fields — used when
 * the model chain is unavailable or the reply is unusable. Always well-shaped.
 */
export function deterministicCaseSummary(input: CaseSummaryInput): CaseSummary {
  const themes: string[] = [];
  for (const e of input.encounters) {
    if (e.aggregateTag && !themes.includes(e.aggregateTag)) themes.push(e.aggregateTag);
    if (themes.length >= 4) break;
  }

  const latest = input.encounters[0] ?? null;
  const verdict = latest
    ? latest.escalation
      ? "latest visit escalated as a crisis override"
      : `latest visit classified "${latest.classification.replace(/_/g, " ")}"`
    : "no linked encounters recorded yet";

  const parts: string[] = [];
  parts.push(
    `Case ${input.caseCode} (${input.category.replace(/_/g, " ")}, ${input.county}${
      input.ward ? ` · ${input.ward}` : ""
    }) is at "${input.caseStatus.replace(/_/g, " ")}".`
  );
  if (latest) {
    parts.push(
      `${verdict.charAt(0).toUpperCase()}${verdict.slice(1)}${
        latest.indicators.length
          ? `, with ${latest.indicators.length} recorded indicator${latest.indicators.length === 1 ? "" : "s"}`
          : ""
      }.`
    );
  } else {
    parts.push("No linked encounters recorded yet.");
  }
  if (themes.length > 0) {
    parts.push(`Recurring themes across visits: ${themes.join(", ")}.`);
  }
  const outstanding = outstandingFromState(input);
  if (outstanding.length > 0) {
    parts.push(`Outstanding: ${outstanding.join("; ")}.`);
  }
  parts.push("Verify details with the CHV before acting — advisory only.");

  return {
    narrative: capWords(parts.join(" "), CASE_SUMMARY_MAX_WORDS),
    themes: themes.slice(0, 4),
    outstandingActions: outstanding,
  };
}

/**
 * Generate the advisory case summary. Live model path when Qwen is
 * configured; deterministic fallback otherwise (and on any model/parse
 * failure). Never throws.
 */
export async function buildCaseSummary(
  input: CaseSummaryInput
): Promise<CaseSummaryResult> {
  const fallback = (): CaseSummaryResult => ({
    summary: deterministicCaseSummary(input),
    fallbackUsed: true,
    model: "fallback",
    promptVersion: CASE_SUMMARY_PROMPT_VERSION,
  });

  if (!qwenConfigured()) return fallback();

  // Aggregate-only, structured payload — compact so the prompt stays small.
  const payload = {
    case_code: input.caseCode,
    category: input.category,
    case_status: input.caseStatus,
    county: input.county,
    ward: input.ward,
    policy_workflow_class: input.policyWorkflowClass,
    lifecycle: {
      assigned: input.assigned,
      accepted: input.accepted,
      attended: input.attended,
      resolved: input.resolved,
    },
    outcome_category: input.outcomeCategory,
    encounters: input.encounters.slice(0, 8).map((e) => ({
      date: e.date,
      classification: e.escalation ? "crisis_override" : e.classification,
      indicators: e.indicators.slice(0, 6),
      aggregate_tag: e.aggregateTag,
      chp_next_action: e.chpNextAction,
      missing_information: e.missingInformation,
    })),
    follow_ups: input.followUps.slice(0, 8).map((f) => ({
      status: f.status,
      due_at: f.dueAt,
      resolved_at: f.resolvedAt,
    })),
  };

  try {
    const { content, model } = await qwenChat({
      task: "case_summary",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
      json: true,
      temperature: 0.2,
      maxTokens: 500,
      timeoutMs: 12_000,
    });
    const obj = parseJsonObject(content);
    const narrative = typeof obj?.narrative === "string" ? obj.narrative.trim() : "";
    if (!narrative) return fallback();
    return {
      summary: {
        narrative: capWords(narrative, CASE_SUMMARY_MAX_WORDS),
        themes: stringList(obj?.themes, 4, 60),
        outstandingActions: stringList(obj?.outstanding_actions, 4, 140),
      },
      fallbackUsed: false,
      model,
      promptVersion: CASE_SUMMARY_PROMPT_VERSION,
    };
  } catch (err) {
    console.error(
      "[qwen] case summary failed:",
      err instanceof Error ? err.message : err
    );
    return fallback();
  }
}
