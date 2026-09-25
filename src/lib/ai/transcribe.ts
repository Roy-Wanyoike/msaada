import { qwenChat, type ChatMessage } from "@/lib/ai/client";

/**
 * Speech-to-text for CHV voice notes (Qwen ASR, OpenAI-compatible API).
 *
 * The audio is sent to the model and discarded: neither the audio nor the
 * transcript is stored. The transcript goes back to the CHV, who reviews and
 * edits it before submitting; the submitted text is then PII-scrubbed by
 * /api/triage like any typed observation.
 *
 * Env: QWEN_ASR_MODEL (default "qwen3-asr-flash").
 */

const DEFAULT_ASR_MODEL = "qwen3-asr-flash";

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

  const messages: ChatMessage[] = [
    { role: "system", content: [{ type: "text", text: ASR_CONTEXT }] },
    { role: "user", content: [{ type: "input_audio", input_audio: { data: dataUri } }] },
  ];

  const { content, model } = await qwenChat({
    model: asrModel(),
    messages,
    disableThinking: false,
    // Language auto-detect (Kiswahili/English mix); inverse text normalisation
    // off so numbers and names come back as spoken.
    extraBody: { asr_options: { enable_itn: false } },
    timeoutMs: 45_000,
  });

  return { text: content.trim(), model };
}
