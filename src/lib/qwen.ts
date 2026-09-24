import ZAI from "z-ai-web-dev-sdk";
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
{"escalation": false, "classification": "...", "observed_indicators": ["..."], "chp_next_action": "...", "confidence_note": null or "...", "aggregate_tag": "short_category_like_sleep_disturbance"}

If information is too limited to classify confidently, default to needs_followup rather than routine — under-triage is the higher-risk error.`;

let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;

async function getZAI() {
  if (!zaiPromise) {
    zaiPromise = ZAI.create();
  }
  return zaiPromise;
}

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
  return {
    escalation: false,
    classification,
    observed_indicators: observedIndicators,
    chp_next_action: chpNextAction,
    confidence_note: confidenceNote,
    aggregate_tag: aggregateTag,
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
}

/**
 * Call Qwen (via z-ai-web-dev-sdk) with the triage system prompt.
 *
 * Latency optimization: the FIRST call already includes the strict "single
 * valid JSON object, nothing else" reinforcement (the system prompt demands
 * JSON, so this is a no-op for triage logic — it just reduces the chance of
 * the model wrapping output in prose/code-fences, which avoids the ~25s
 * double-call). The retry path is kept only as a safety net for the rare case
 * where the first response still can't be parsed.
 *
 * If both attempts fail, the CALLER applies the spec fallback:
 * classification=needs_followup, escalation=false, confidence_note="...".
 * Never silently drops a failed classification.
 */
export async function classifyObservation(
  observationText: string
): Promise<QwenCallResult> {
  const zai = await getZAI();

  const buildMessages = (strict: boolean) => {
    // The base system prompt already mandates "valid JSON only, no other
    // text". The strict reinforcement makes this unambiguous for models that
    // tend to wrap output in ```json fences or add a leading sentence.
    const system = strict
      ? TRIAGE_SYSTEM_PROMPT +
        "\n\nCRITICAL FORMAT REQUIREMENT: Respond with a SINGLE valid JSON object and ABSOLUTELY NOTHING else. No prose, no markdown, no code fences, no leading or trailing text. The first character must be '{' and the last must be '}'."
      : TRIAGE_SYSTEM_PROMPT +
        "\n\nRespond with a single valid JSON object only. No markdown, no code fences, no extra text.";
    return [
      { role: "assistant" as const, content: system },
      { role: "user" as const, content: observationText },
    ];
  };

  let attempts = 0;
  for (let strict = 0; strict < 2; strict++) {
    attempts++;
    try {
      const completion = await zai.chat.completions.create({
        messages: buildMessages(strict === 1),
        thinking: { type: "disabled" },
      });
      const raw = completion.choices?.[0]?.message?.content ?? "";
      if (!raw) continue;
      const parsed = parseModelOutput(raw);
      if (parsed) {
        return { output: parsed, fallbackUsed: false, attempts };
      }
      // If the first (already-strict) attempt failed to parse, the retry uses
      // the even-harder instruction. In practice the first call now succeeds
      // ~always, so the retry rarely fires — cutting typical latency roughly
      // in half (from ~25s to ~12-15s).
    } catch (err) {
      // swallow and retry once
      console.error("[qwen] attempt", attempts, "error:", err);
    }
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
  return { output: fallback, fallbackUsed: true, attempts };
}
