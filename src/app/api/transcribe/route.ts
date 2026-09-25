import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { QwenError, qwenConfigured } from "@/lib/ai/client";
import {
  ALLOWED_AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  transcribeAudio,
} from "@/lib/ai/transcribe";

export const dynamic = "force-dynamic";

/**
 * POST /api/transcribe — multipart form with an `audio` file.
 * Returns { text, model }. Nothing is stored or logged except the failure
 * reason; the audio is held in memory for the duration of the request only.
 */
export async function POST(req: Request) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const rl = checkRateLimit(`transcribe:${chv.id}`, { capacity: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter: Math.ceil(rl.retryAfterMs / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  if (!qwenConfigured()) {
    return NextResponse.json({ error: "AI_NOT_CONFIGURED" }, { status: 503 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get("audio");
    file = value instanceof File ? value : null;
  } catch {
    return NextResponse.json({ error: "INVALID_FORM" }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "MISSING_AUDIO" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "AUDIO_TOO_LARGE" }, { status: 413 });
  }
  const baseType = (file.type || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.includes(baseType)) {
    return NextResponse.json({ error: "UNSUPPORTED_AUDIO_TYPE" }, { status: 415 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await transcribeAudio(bytes, baseType);
    if (!result.text) {
      return NextResponse.json({ error: "NO_SPEECH_DETECTED" }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error(
      "[transcribe] failed:",
      err instanceof Error ? err.message : err
    );
    const timeout = err instanceof QwenError && err.kind === "timeout";
    return NextResponse.json(
      { error: timeout ? "TRANSCRIBE_TIMEOUT" : "TRANSCRIBE_FAILED" },
      { status: timeout ? 504 : 502 }
    );
  }
}
