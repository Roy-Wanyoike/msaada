import { qwenChat, qwenModel, QwenError, type ChatMessage } from "@/lib/ai/client";
import {
  CLASSIFICATIONS,
  type Classification,
  type TriageModelOutput,
  type CrisisResult,
  type NormalResult,
} from "@/lib/types";

/**
 * The fixed triage system prompt — copied verbatim from the build spec.
 * DO NOT modify the crisis logic.
 */
export const TRIAGE_SYSTEM_PROMPT = `You are Msaada, an AI triage-support tool for Community Health Volunteers (CHVs) in Kenya conducting routine household visits. You are NOT a diagnostic tool and NOT a therapist. Convert the CHV's observation into a standardized WHO-aligned community mental health triage flag.

CRISIS OVERRIDE (check first, always): If the observation contains any indication of suicidal ideation, expressed intent to self-harm, a means/plan mentioned, or acute danger to self or others, output ONLY: {"escalation": true, "chp_instruction": "Do not leave the household unaccompanied. Contact your CHV supervisor and the nearest Level 4+ facility immediately. If immediate danger, call Kenya Red Cross Emergency: 1199.", "crisis_line": "Kenya Red Cross Emergency: 1199 | Befrienders Kenya: +254 722 178 177", "record_for_reporting": true}

Otherwise classify into exactly one of: routine, needs_followup, needs_facility_referral. Never diagnose. Describe only observed behavioral indicators (sleep, appetite, withdrawal, expressed distress) — never clinical labels. Output valid JSON only, no other text:
{"escalation": false, "classification": "...", "observed_indicators": ["..."], "chp_next_action": "...", "chp_next_action_sw": "the same next action, in natural Kiswahili", "reasoning": "1-2 plain sentences for the CHV explaining why this classification, citing only the behaviours described (no names or places)", "confidence_note": null or "...", "aggregate_tag": "short_category_like_sleep_disturbance"}

If information is too limited to classify confidently, default to needs_followup rather than routine — under-triage is the higher-risk error.`;

/**
 * Version of the prompt + parsing contract above. Bump it whenever
 * TRIAGE_SYSTEM_PROMPT or the output schema changes; it is stored on every
 * TriageRecord so each classification can be traced to the prompt that made it.
 */
export const TRIAGE_PROMPT_VERSION = "triage-v1.2";

/** Recorded as the model when no model produced the result. */
export const FALLBACK_MODEL = "fallback";

/**
 * Deterministic crisis screen. It guards BOTH paths (issue #45):
 *  1. the model-failure fallback (below) — without it the needs_followup
 *     fallback would silently under-triage a crisis statement, and
 *  2. the model-SUCCESS path (see classifyObservation) — a model that answers
 *     normally for crisis text must never be trusted with a non-escalation
 *     verdict; the screen forces the CRISIS output over the model result.
 * Deliberately broad (English, Kiswahili, Sheng): a false positive costs an
 * unnecessary escalation; a false negative can cost a life.
 */
const CRISIS_PATTERNS: RegExp[] = [
  // English
  /\b(suicid\w*|kill (him|her|them)sel(f|ves)|kill myself|end (his|her|my|their) (own )?life|take (his|her|my|their) (own )?life)\b/i,
  /\b(self[- ]?harm\w*|harm(ing)? (him|her|them|my)sel(f|ves)|cut(ting)? (him|her|them|my)sel(f|ves))\b/i,
  /\b(want(s|ed)? to die|wish(es|ed)? (he|she|they|i) (was|were) dead|no reason to live|better off dead|overdose)\b/i,
  /\b(hang(ing)? (him|her|them|my)sel(f|ves)|jump(ed|ing)? (off|into)|drown (him|her|them|my)sel(f|ves))\b/i,
  // Kiswahili / Sheng
  /\b(kujiua|anataka kujiua|nataka kujiua|kujidhuru|kujiumiza|kujinyonga|kujikata)\b/i,
  /\b(hana sababu ya kuishi|sina sababu ya kuishi|anataka kufa|nataka kufa|afadhali kufa|maisha hayana maana)\b/i,
  /\b(sumu|kisu|kamba ya kujinyonga|dawa nyingi)\b/i,
  /\b(hatari ya moja kwa moja|msaada wa dharura|ataingia (mto|river))\b/i,
];

export function crisisKeywordScreen(text: string): boolean {
  return CRISIS_PATTERNS.some((re) => re.test(text));
}

export const CRISIS_OUTPUT: CrisisResult = {
  escalation: true,
  chp_instruction:
    "Do not leave the household unaccompanied. Contact your CHV supervisor and the nearest Level 4+ facility immediately. If immediate danger, call Kenya Red Cross Emergency: 1199.",
  crisis_line:
    "Kenya Red Cross Emergency: 1199 | Befrienders Kenya: +254 722 178 177",
  record_for_reporting: true,
};

function stripJsonFence(raw: string): string {
  let s = raw.trim();
  // Remove ```json ... ``` fences if the model wraps output.
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  return s;
}

function isClassification(v: unknown): v is Classification {
  return typeof v === "string" && CLASSIFICATIONS.includes(v as Classification);
}

function coerceNormal(obj: Record<string, unknown>): NormalResult | null {
  const escalation = obj.escalation;
  if (escalation === true) return null; // not the normal path
  const classification = obj.classification;
  if (!isClassification(classification)) return null;
  const observedIndicators = Array.isArray(obj.observed_indicators)
    ? obj.observed_indicators.filter((x): x is string => typeof x === "string")
    : [];
  const chpNextAction =
    typeof obj.chp_next_action === "string" ? obj.chp_next_action : "";
  const confidenceNote =
    typeof obj.confidence_note === "string" && obj.confidence_note.length > 0
      ? obj.confidence_note
      : null;
  const aggregateTag =
    typeof obj.aggregate_tag === "string" && obj.aggregate_tag.length > 0
      ? obj.aggregate_tag
      : "general";
  const optionalText = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null;
  return {
    escalation: false,
    classification,
    observed_indicators: observedIndicators,
    chp_next_action: chpNextAction,
    confidence_note: confidenceNote,
    aggregate_tag: aggregateTag,
    reasoning: optionalText(obj.reasoning),
    chp_next_action_sw: optionalText(obj.chp_next_action_sw),
  };
}

function coerceCrisis(obj: Record<string, unknown>): CrisisResult | null {
  if (obj.escalation !== true) return null;
  const chpInstruction =
    typeof obj.chp_instruction === "string" && obj.chp_instruction.length > 0
      ? obj.chp_instruction
      : "Do not leave the household unaccompanied. Contact your CHV supervisor and the nearest Level 4+ facility immediately. If immediate danger, call Kenya Red Cross Emergency: 1199.";
  const crisisLine =
    typeof obj.crisis_line === "string" && obj.crisis_line.length > 0
      ? obj.crisis_line
      : "Kenya Red Cross Emergency: 1199 | Befrienders Kenya: +254 722 178 177";
  return {
    escalation: true,
    chp_instruction: chpInstruction,
    crisis_line: crisisLine,
    record_for_reporting: obj.record_for_reporting === true,
  };
}

function parseModelOutput(raw: string): TriageModelOutput | null {
  const cleaned = stripJsonFence(raw);
  // Try to extract the first {...} block in case the model added stray text.
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const candidate =
    firstBrace >= 0 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (obj.escalation === true) {
    return coerceCrisis(obj);
  }
  return coerceNormal(obj);
}

export interface QwenCallResult {
  output: TriageModelOutput;
  fallbackUsed: boolean;
  attempts: number;
  /** Model that produced `output`, or FALLBACK_MODEL. */
  model: string;
  promptVersion: string;
}

/**
 * Call Qwen (see src/lib/ai/client.ts) with the triage system prompt.
 *
 * Latency optimization: the FIRST call already includes the strict "single
 * valid JSON object, nothing else" reinforcement (the system prompt demands
 * JSON, so this is a no-op for triage logic — it just reduces the chance of
 * the model wrapping output in prose/code-fences, which avoids the ~25s
 * double-call). The retry path is kept only as a safety net for the rare case
 * where the first response still can't be parsed.
 *
 * SAFETY (issue #45): a successful, non-escalation model verdict is STILL
 * screened with the deterministic crisisKeywordScreen on the same (scrubbed)
 * text. If the screen fires, the CRISIS output is forced (workflowClass
 * crisis_override via the same constants the fallback uses) while aiModel
 * stays the answering model — the model answered; the screen overrode it —
 * and the confidence_note records exactly that. The fallback-path crisis
 * screen is unchanged.
 *
 * If both attempts fail, the CALLER applies the spec fallback:
 * classification=needs_followup, escalation=false, confidence_note="...".
 * Never silently drops a failed classification.
 */
export async function classifyObservation(
  observationText: string
): Promise<QwenCallResult> {
  const buildMessages = (strict: boolean) => {
    // The base system prompt already mandates "valid JSON only, no other
    // text". The strict reinforcement makes this unambiguous for models that
    // tend to wrap output in ```json fences or add a leading sentence.
    const system = strict
      ? TRIAGE_SYSTEM_PROMPT +
        "\n\nCRITICAL FORMAT REQUIREMENT: Respond with a SINGLE valid JSON object and ABSOLUTELY NOTHING else. No prose, no markdown, no code fences, no leading or trailing text. The first character must be '{' and the last must be '}'."
      : TRIAGE_SYSTEM_PROMPT +
        "\n\nRespond with a single valid JSON object only. No markdown, no code fences, no extra text.";
    const messages: ChatMessage[] = [
      // Must be the system role: sent as "assistant" (as before), the model
      // treats the crisis rules as its own prior turn, not as instructions.
      { role: "system", content: system },
      { role: "user", content: observationText },
    ];
    return messages;
  };

  let attempts = 0;
  for (let strict = 0; strict < 2; strict++) {
    attempts++;
    try {
      // Inside the try: a missing key, timeout or HTTP error must reach the
      // fallback below, not crash the request with a 500.
      const { content, model } = await qwenChat({
        task: "triage",
        messages: buildMessages(strict === 1),
        json: true,
        temperature: 0.1,
        maxTokens: 800,
      });
      const parsed = parseModelOutput(content);
      if (parsed) {
        // Safety net on the model-SUCCESS path (issue #45): the model's
        // non-escalation verdict must not be trusted when the deterministic
        // crisis keyword screen fires on the same scrubbed text. Force the
        // CRISIS output (same constants the fallback uses → the policy
        // engine sees workflowClass crisis_override) but keep aiModel —
        // provenance says the model answered; the screen overrode it.
        if (!parsed.escalation && crisisKeywordScreen(observationText)) {
          return {
            output: {
              ...CRISIS_OUTPUT,
              confidence_note:
                "crisis keyword screen overrode model classification — the model answered; the deterministic safety screen forced the crisis output",
            },
            fallbackUsed: false,
            attempts,
            model,
            promptVersion: TRIAGE_PROMPT_VERSION,
          };
        }
        return {
          output: parsed,
          fallbackUsed: false,
          attempts,
          model,
          promptVersion: TRIAGE_PROMPT_VERSION,
        };
      }
      // If the first (already-strict) attempt failed to parse, the retry uses
      // the even-harder instruction. In practice the first call now succeeds
      // ~always, so the retry rarely fires — cutting typical latency roughly
      // in half (from ~25s to ~12-15s).
    } catch (err) {
      console.error(
        `[qwen] triage attempt ${attempts} (${qwenModel()}) failed:`,
        err instanceof Error ? err.message : err
      );
      // A missing or rejected key won't fix itself on retry — go straight to
      // the fallback. (Timeouts, 429s and 5xx are worth one more try.)
      if (
        err instanceof QwenError &&
        (err.kind === "not_configured" || err.status === 401 || err.status === 403)
      ) {
        break;
      }
    }
  }

  return fallbackTriage(observationText, attempts);
}

/**
 * Result used when no model produced a usable answer. Screens for crisis
 * language first, so a model outage can never downgrade a crisis to routine
 * follow-up; otherwise applies the spec fallback (needs_followup). Shared by
 * every AI task whose output feeds the policy engine.
 */
export function fallbackTriage(text: string, attempts: number): QwenCallResult {
  const fallbackMeta = {
    fallbackUsed: true,
    attempts,
    model: FALLBACK_MODEL,
    promptVersion: TRIAGE_PROMPT_VERSION,
  };

  if (crisisKeywordScreen(text)) {
    return { output: CRISIS_OUTPUT, ...fallbackMeta };
  }

  // Spec-mandated fallback: never silently drop.
  const fallback: NormalResult = {
    escalation: false,
    classification: "needs_followup",
    observed_indicators: [],
    chp_next_action:
      "Revisit the household within 48 hours to gather a more complete observation. If new concern arises, escalate.",
    confidence_note:
      "model output could not be parsed, defaulting to caution",
    aggregate_tag: "incomplete_observation",
  };
  return { output: fallback, ...fallbackMeta };
}
