/**
 * Qwen client — the single place Msaada talks to a language model.
 *
 * Uses the ModelScope OpenAI-compatible Chat Completions API
 * (Hack for Humanity with Qwen inference endpoint) over plain fetch — no SDK
 * dependency. Every AI task in src/lib/ai/ goes through `qwenChat`, so
 * timeouts, auth and error handling live here once.
 *
 * Configuration (server-only env vars — put secrets in .env.local, which is
 * git-ignored):
 *   QWEN_API_KEY   required. ModelScope API key.
 *   QWEN_MODEL     optional. Default "Qwen-Ambassador/Qwen3.8-Max".
 *   QWEN_BASE_URL  optional. Default https://api-inference.modelscope.ai/v1.
 *                  For DashScope/Model Studio accounts use
 *                  https://dashscope-intl.aliyuncs.com/compatible-mode/v1.
 *   QWEN_TIMEOUT_MS optional. Per-request timeout, default 15000.
 *   QWEN_ASR_MODEL optional. Speech-to-text model, default "qwen3-asr-flash"
 *                  (NOT hosted on ModelScope — see transcribe.ts).
 *   QWEN_ASR_BASE_URL optional. Endpoint override for ASR calls only, so a
 *                  DashScope key can be used for speech-to-text while chat
 *                  runs on ModelScope.
 *
 * Tasks: triage.ts (CHV observations), report-intake.ts (public reports),
 * transcribe.ts (voice notes), summaries.ts (dashboard briefing),
 * followup.ts (follow-up visit questions).
 */

import { db } from "@/lib/db";

/** Every Qwen use in the app, logged per call for the impact meter. */
export type AiTask =
  | "triage"
  | "report_intake"
  | "transcribe"
  | "privacy_scan"
  | "assignment"
  | "referral_handover"
  | "case_outcome"
  | "chv_weekly"
  | "supervisor_briefing"
  | "dashboard_summary"
  | "followup_questions";

const DEFAULT_BASE_URL = "https://api-inference.modelscope.ai/v1";
const DEFAULT_MODEL = "Qwen-Ambassador/Qwen3.8-Max";
const DEFAULT_TIMEOUT_MS = 15_000;

export type ChatRole = "system" | "user" | "assistant";

/** Multimodal content part (OpenAI-compatible). Audio is a data: URI or URL. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "input_audio"; input_audio: { data: string; format?: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
}

export interface QwenChatOptions {
  /** Which feature is calling; recorded in AiActivity (metadata only). */
  task: AiTask;
  messages: ChatMessage[];
  /** Ask the API to return a single JSON object (response_format json_object). */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Overrides QWEN_MODEL for this call. */
  model?: string;
  /** Overrides QWEN_BASE_URL for this call (e.g. ASR on a different host). */
  baseUrl?: string;
  timeoutMs?: number;
  /**
   * Send enable_thinking=false (default true). Set false for models that
   * don't take the parameter, e.g. speech recognition.
   */
  disableThinking?: boolean;
  /** Model-specific request fields (e.g. asr_options), merged into the body. */
  extraBody?: Record<string, unknown>;
}

export interface QwenChatResult {
  content: string;
  /** Model id reported by the API (falls back to the requested model). */
  model: string;
}

/** Raised for any failure talking to the model; callers apply their fallback. */
export class QwenError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "not_configured"
      | "timeout"
      | "http"
      | "network"
      | "empty"
      | "invalid_model",
    readonly status?: number
  ) {
    super(message);
    this.name = "QwenError";
  }
}

export function qwenConfigured(): boolean {
  return Boolean(process.env.QWEN_API_KEY?.trim());
}

export function qwenModel(): string {
  return process.env.QWEN_MODEL?.trim() || DEFAULT_MODEL;
}

export async function qwenChat(opts: QwenChatOptions): Promise<QwenChatResult> {
  const started = Date.now();
  try {
    const result = await qwenChatOnce(opts);
    logActivity(opts.task, result.model, true, Date.now() - started, null);
    return result;
  } catch (err) {
    if (err instanceof QwenError && err.kind !== "not_configured") {
      logActivity(opts.task, opts.model ?? qwenModel(), false, Date.now() - started, err.kind);
    }
    throw err;
  }
}

/** Fire-and-forget: the meter must never slow down or break a request. */
function logActivity(
  task: AiTask,
  model: string,
  ok: boolean,
  latencyMs: number,
  errorKind: string | null
) {
  void db.aiActivity
    .create({ data: { task, model, ok, latencyMs, errorKind } })
    .catch((e: unknown) => {
      console.error("[qwen] activity log failed:", e instanceof Error ? e.message : e);
    });
}

async function qwenChatOnce(opts: QwenChatOptions): Promise<QwenChatResult> {
  const apiKey = process.env.QWEN_API_KEY?.trim();
  if (!apiKey) {
    throw new QwenError("QWEN_API_KEY is not set", "not_configured");
  }
  const baseUrl = (opts.baseUrl || process.env.QWEN_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );
  const model = opts.model ?? qwenModel();
  const timeoutMs =
    opts.timeoutMs ?? (Number(process.env.QWEN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.1,
  };
  // Qwen3-family models support a "thinking" mode; our tasks need fast,
  // deterministic-ish output, so keep it off.
  if (opts.disableThinking !== false) body.enable_thinking = false;
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.json) body.response_format = { type: "json_object" };
  if (opts.extraBody) Object.assign(body, opts.extraBody);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new QwenError(`Qwen request timed out after ${timeoutMs}ms`, "timeout");
    }
    throw new QwenError(
      `Qwen request failed: ${err instanceof Error ? err.message : String(err)}`,
      "network"
    );
  }

  if (!res.ok) {
    // Never log the request body (it contains the observation text).
    let detail = "";
    try {
      const errBody = (await res.json()) as { error?: { message?: string; code?: string } };
      detail = errBody.error?.code || errBody.error?.message || "";
    } catch {
      // non-JSON error body
    }
    // A rejected model id won't fix itself on retry — surface it as its own
    // kind so callers can degrade gracefully (e.g. ASR on a host that has no
    // speech models returns 501 instead of a generic 502).
    const invalidModelId = /invalid model id/i.test(detail);
    if (invalidModelId) {
      throw new QwenError(
        `Qwen API rejected model id: ${detail || model}`,
        "invalid_model",
        res.status
      );
    }
    throw new QwenError(
      `Qwen API returned HTTP ${res.status}${detail ? ` (${detail})` : ""}`,
      "http",
      res.status
    );
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string | null } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    throw new QwenError("Qwen returned an empty response", "empty");
  }
  return { content, model: data.model || model };
}

/**
 * Parse a model reply that should be a single JSON object. Tolerates code
 * fences and stray text around the object; returns null if nothing parses.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    const obj: unknown = JSON.parse(s.slice(first, last + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Keep only non-empty strings, trimmed and capped. */
export function stringList(v: unknown, max: number, maxLen = 200): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, maxLen))
    .slice(0, max);
}
