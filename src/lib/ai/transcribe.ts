import { qwenChat, type ChatMessage } from "@/lib/ai/client";

/**
 * Speech-to-text for CHV voice notes (Qwen ASR, OpenAI-compatible API).
 *
 * The audio is sent to the model and discarded: neither the audio nor the
 * transcript is stored. The transcript goes back to the CHV, who reviews and
 * edits it before submitting; the submitted text is then PII-scrubbed by
 * /api/triage like any typed observation.
 *
 * Env: QWEN_ASR_MODEL (default "qwen3-asr-flash") and QWEN_ASR_BASE_URL.
 *
 * ModelScope's inference endpoint hosts chat models only — it rejects
 * qwen3-asr-flash with 400 "Invalid model id". When Msaada runs on ModelScope
 * (Hack for Humanity with Qwen), /api/transcribe degrades gracefully: the
 * client surfaces kind="invalid_model" and the route answers 501
 * ASR_NOT_AVAILABLE, so the UI tells the CHV to type instead. Set
 * QWEN_ASR_BASE_URL (e.g. https://dashscope.aliyuncs.com/compatible-mode/v1)
 * + QWEN_ASR_MODEL with a DashScope key to re-enable voice notes. Works with
 * both kinds of audio model: dedicated ASR models (name contains "asr"; take
 * asr_options) and general audio-understanding "omni" models, which need a
 * written instruction and may answer NO_SPEECH.
 */

// ModelScope-compatible default. Dedicated qwen3-asr-flash deployments still
// work by setting QWEN_ASR_MODEL + QWEN_ASR_BASE_URL explicitly.
const DEFAULT_ASR_MODEL = "Qwen-Ambassador/Qwen3.8-Omni-Flash";

/** Max upload size accepted by /api/transcribe (base64 inflates by ~33%). */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
/** Max recording length the UI allows. */
export const MAX_AUDIO_SECONDS = 180;

export const ALLOWED_AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/x-m4a",
];

/** Biases recognition toward the vocabulary CHVs actually use. */
const ASR_CONTEXT =
  "Kenyan community health volunteer describing a household visit. Speech may be Kiswahili, Sheng, English or code-switched. Common words: mama, mtoto, kijana, hajalala, hali chakula, peke yake, wasiwasi, CHV, dispensary, Kilifi, Mombasa, Nairobi, Turkana.";

const TRANSCRIBE_INSTRUCTION =
  "Transcribe this audio verbatim in the language(s) spoken (Kiswahili, Sheng and English are common; keep code-switching as spoken). Do not translate, summarise or add anything. Output only the transcript. If there is no intelligible speech, output exactly: NO_SPEECH";

/** Returned by omni models when the recording has no speech. */
const NO_SPEECH = "NO_SPEECH";

export interface TranscribeResult {
  text: string;
  model: string;
}

function asrModel(): string {
  return process.env.QWEN_ASR_MODEL?.trim() || DEFAULT_ASR_MODEL;
}

export async function transcribeAudio(
  audio: Uint8Array,
  mimeType: string
): Promise<TranscribeResult> {
  // Strip codec params ("audio/webm;codecs=opus" → "audio/webm").
  const baseType = mimeType.split(";")[0].trim().toLowerCase();
  const dataUri = `data:${baseType};base64,${Buffer.from(audio).toString("base64")}`;

  const model = asrModel();
  const isAsrModel = /asr/i.test(model);
  const format = baseType.split("/")[1]?.replace(/^x-/, "") ?? "wav";
  const audioPart = {
    type: "input_audio" as const,
    input_audio: { data: dataUri, format },
  };

  const messages: ChatMessage[] = isAsrModel
    ? [
        // ASR models use the system message as recognition context.
        { role: "system", content: [{ type: "text", text: ASR_CONTEXT }] },
        { role: "user", content: [audioPart] },
      ]
    : [
        { role: "system", content: ASR_CONTEXT },
        { role: "user", content: [audioPart, { type: "text", text: TRANSCRIBE_INSTRUCTION }] },
      ];

  const { content, model: usedModel } = await qwenChat({
    task: "transcribe",
    model,
    messages,
    temperature: 0,
    // ASR models reject enable_thinking; omni models are faster without it.
    disableThinking: !isAsrModel,
    // ASR models live on DashScope, not ModelScope — allow a per-call host
    // override without touching the chat endpoint.
    baseUrl: process.env.QWEN_ASR_BASE_URL?.trim() || undefined,
    // ASR only: auto-detect language, keep numbers and names as spoken.
    extraBody: isAsrModel ? { asr_options: { enable_itn: false } } : undefined,
    timeoutMs: 60_000,
  });

  const text = content.trim();
  return { text: text === NO_SPEECH ? "" : text, model: usedModel };
}
