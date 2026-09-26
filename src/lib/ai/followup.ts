import { parseJsonObject, qwenChat, stringList } from "@/lib/ai/client";

/**
 * Suggested questions for a CHV's follow-up visit.
 *
 * Built only from the earlier visit's STRUCTURED result (classification,
 * observed-indicator labels, tag, recommended action). No observation text
 * exists to send: the triage flow never stores it.
 *
 * Advisory: the CHV decides what to ask. For escalated (crisis) records the
 * safety step is fixed text, not model output, so it can never be softened.
 */

export const FOLLOWUP_PROMPT_VERSION = "followup-questions-v1";

export const CRISIS_SAFETY_STEP =
  "First check the person is safe right now. If there is any immediate danger, do not leave them alone: contact your supervisor and call Kenya Red Cross 1199.";

export interface FollowUpContext {
  classification: string;
  escalation: boolean;
  observedIndicators: string[];
  aggregateTag: string | null;
  chpNextAction: string | null;
  daysSinceVisit: number;
}

export interface FollowUpQuestion {
  sw: string;
  en: string;
}

export interface FollowUpSuggestions {
  safetyStep: string | null;
  questions: FollowUpQuestion[];
  lookFor: string[];
  model: string;
  promptVersion: string;
}

const SYSTEM_PROMPT = `You help Community Health Volunteers (CHVs) in Kenya prepare for a follow-up household visit about community mental health and wellbeing. You get the structured result of the earlier visit (no personal details).

Suggest what the CHV could ask to see whether things have changed since then. Rules:
- 3 short, open, gentle questions. Kiswahili first, with an English translation.
- Ask about everyday things (sleep, eating, daily activities, support from family, how they feel) and about whether the recommended action happened.
- Never diagnose, never use clinical labels, never suggest medication.
- "look_for": up to 3 short things the CHV can notice without asking.

Respond with a single JSON object only:
{"questions": [{"sw": "...", "en": "..."}], "look_for": ["..."]}`;

function toQuestions(v: unknown): FollowUpQuestion[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (q): q is { sw: string; en: string } =>
        !!q &&
        typeof q === "object" &&
        typeof (q as { sw?: unknown }).sw === "string" &&
        typeof (q as { en?: unknown }).en === "string"
    )
    .map((q) => ({ sw: q.sw.trim().slice(0, 200), en: q.en.trim().slice(0, 200) }))
    .filter((q) => q.sw && q.en)
    .slice(0, 3);
}

export async function suggestFollowUpQuestions(
  ctx: FollowUpContext
): Promise<FollowUpSuggestions | null> {
  const safetyStep = ctx.escalation ? CRISIS_SAFETY_STEP : null;
  const data = {
    earlier_result: ctx.escalation ? "crisis_escalation" : ctx.classification,
    observed_indicators: ctx.observedIndicators,
    signal_tag: ctx.aggregateTag,
    recommended_action: ctx.chpNextAction,
    days_since_earlier_visit: ctx.daysSinceVisit,
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { content, model } = await qwenChat({
        task: "followup_questions",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(data) },
        ],
        json: true,
        temperature: 0.3,
        maxTokens: 600,
      });
      const obj = parseJsonObject(content);
      const questions = toQuestions(obj?.questions);
      if (questions.length === 0) continue;
      return {
        safetyStep,
        questions,
        lookFor: stringList(obj?.look_for, 3),
        model,
        promptVersion: FOLLOWUP_PROMPT_VERSION,
      };
    } catch (err) {
      console.error(
        `[qwen] follow-up suggestions attempt ${attempt} failed:`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }
  return null;
}
