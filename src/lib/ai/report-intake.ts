import {
  parseJsonObject,
  qwenChat,
  QwenError,
  stringList,
  type ChatMessage,
} from "@/lib/ai/client";
import {
  CRISIS_OUTPUT,
  fallbackTriage,
  type QwenCallResult,
} from "@/lib/ai/triage";
import { CLASSIFICATIONS, type Classification, type NormalResult } from "@/lib/types";

/**
 * AI intake for community reports submitted by the public (/report).
 *
 * Unlike CHV observations, these are written by neighbours, relatives or the
 * person themselves, are often vague, and need operational help: a short
 * summary for the CHV, how urgent it seems, and what to ask on arrival.
 *
 * The triage verdict it returns has the same shape as classifyObservation's,
 * so the deterministic policy engine is unchanged. The crisis rule is the
 * same as the CHV triage prompt's, and model failures fall back exactly like
 * triage (crisis keyword screen, then needs_followup).
 */

export const REPORT_INTAKE_PROMPT_VERSION = "report-intake-v1";

const REPORT_CATEGORIES = [
  "mental_health",
  "maternal",
  "child_health",
  "social_support",
  "other",
] as const;
type ReportCategory = (typeof REPORT_CATEGORIES)[number];

const URGENCIES = ["low", "medium", "high"] as const;
export type Urgency = (typeof URGENCIES)[number];

/** Operational extras shown to the CHV/supervisor. Advisory only. */
export interface ReportIntake {
  summary: string;
  urgency: Urgency;
  suggestedCategory: ReportCategory;
  questionsForVisit: string[];
  missingInformation: string[];
}

export interface ReportIntakeResult extends QwenCallResult {
  /** Null when the model didn't answer (fallback path). */
  intake: ReportIntake | null;
}

const SYSTEM_PROMPT = `You are Msaada's intake assistant. A member of the public in Kenya has submitted a concern about someone in their community (or themselves) so that a Community Health Volunteer (CHV) can visit. Personal names, phone numbers and IDs have already been removed. The text may be Kiswahili, Sheng, English or mixed, and may be short or vague.

You are NOT a diagnostic tool. Never diagnose or use clinical labels. Describe only what the reporter says they observed.

CRISIS OVERRIDE (check first, always): if the report contains any indication of suicidal ideation, expressed intent to self-harm, a means/plan mentioned, or acute danger to self or others, set "crisis": true.

Otherwise pick "classification": routine, needs_followup or needs_facility_referral. If information is too limited to judge, use needs_followup, never routine: under-triage is the higher-risk error.

Respond with a single JSON object only:
{
  "crisis": true | false,
  "classification": "routine" | "needs_followup" | "needs_facility_referral",
  "urgency": "low" | "medium" | "high",
  "suggested_category": "mental_health" | "maternal" | "child_health" | "social_support" | "other",
  "observed_indicators": ["behaviours the reporter describes, e.g. not sleeping"],
  "summary": "One or two plain-English sentences for the CHV: who the concern is about (e.g. 'a pregnant woman', 'a teenage boy') and what was noticed.",
  "questions_for_visit": ["Up to 3 short, gentle questions the CHV could ask on arrival, in Kiswahili"],
  "missing_information": ["Up to 3 things the report does not say that the CHV should find out"],
  "chp_next_action": "One sentence: what the CHV should do next.",
  "aggregate_tag": "short_snake_case_category_like_sleep_disturbance"
}
When "crisis" is true, "urgency" must be "high".`;

function isClassification(v: unknown): v is Classification {
  return typeof v === "string" && CLASSIFICATIONS.includes(v as Classification);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function toIntake(obj: Record<string, unknown>, crisis: boolean): ReportIntake {
  return {
    summary: typeof obj.summary === "string" ? obj.summary.trim().slice(0, 400) : "",
    urgency: crisis ? "high" : oneOf(obj.urgency, URGENCIES, "medium"),
    suggestedCategory: oneOf(obj.suggested_category, REPORT_CATEGORIES, "other"),
    questionsForVisit: stringList(obj.questions_for_visit, 3),
    missingInformation: stringList(obj.missing_information, 3),
  };
}

export async function analyzeCommunityReport(
  reportText: string
): Promise<ReportIntakeResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: reportText },
  ];

  let attempts = 0;
  for (let i = 0; i < 2; i++) {
    attempts++;
    try {
      const { content, model } = await qwenChat({
        messages,
        json: true,
        temperature: 0.1,
        maxTokens: 900,
      });
      const obj = parseJsonObject(content);
      if (!obj) continue;
      const meta = {
        fallbackUsed: false,
        attempts,
        model,
        promptVersion: REPORT_INTAKE_PROMPT_VERSION,
      };

      if (obj.crisis === true) {
        return {
          output: CRISIS_OUTPUT,
          intake: toIntake(obj, true),
          ...meta,
        };
      }
      if (!isClassification(obj.classification)) continue;
      const output: NormalResult = {
        escalation: false,
        classification: obj.classification,
        observed_indicators: stringList(obj.observed_indicators, 8),
        chp_next_action:
          typeof obj.chp_next_action === "string" ? obj.chp_next_action : "",
        confidence_note: null,
        aggregate_tag:
          typeof obj.aggregate_tag === "string" && obj.aggregate_tag
            ? obj.aggregate_tag
            : "general",
      };
      return { output, intake: toIntake(obj, false), ...meta };
    } catch (err) {
      console.error(
        `[qwen] report intake attempt ${attempts} failed:`,
        err instanceof Error ? err.message : err
      );
      if (
        err instanceof QwenError &&
        (err.kind === "not_configured" || err.status === 401 || err.status === 403)
      ) {
        break;
      }
    }
  }

  return {
    ...fallbackTriage(reportText, attempts),
    promptVersion: REPORT_INTAKE_PROMPT_VERSION,
    intake: null,
  };
}
