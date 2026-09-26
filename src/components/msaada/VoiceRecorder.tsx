"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Records a voice note in the browser and returns Qwen's transcript.
 *
 * The audio goes to /api/transcribe and is discarded there; this component
 * keeps it only until the upload finishes. The transcript is handed to the
 * parent, which shows it in an editable field so the CHV can correct it
 * before submitting.
 */

const MAX_SECONDS = 180;

const ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: "Voice-to-text isn't set up on this server yet. Type your observation instead.",
  ASR_NOT_AVAILABLE: "Voice-to-text isn't available on this AI provider. Type your observation instead.",
  AUDIO_TOO_LARGE: "That recording is too long. Keep voice notes under 3 minutes.",
  UNSUPPORTED_AUDIO_TYPE: "This browser records in a format we can't transcribe. Type your observation instead.",
  NO_SPEECH_DETECTED: "No speech was detected. Try again closer to the microphone.",
  TRANSCRIBE_TIMEOUT: "Transcription took too long. Try a shorter recording.",
  RATE_LIMITED: "Too many recordings in a short time. Wait a minute and try again.",
  UNAUTHORIZED: "Your session has expired. Sign in again.",
};

type State = "idle" | "recording" | "uploading";

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      // Some older WebKit builds lack isTypeSupported — try the next mime.
    }
  }
  return undefined;
}

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface VoiceRecorderError {
  /** API error code (e.g. "ASR_NOT_AVAILABLE") or a client-side marker like
   *  "MIC_BLOCKED" / "INSECURE_CONTEXT" / "NO_RECORDER" / null for unknown. */
  code: string | null;
  message: string;
}

export function VoiceRecorder({
  onTranscript,
  disabled,
  maxSeconds = MAX_SECONDS,
  onError,
  onRecordingChange,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  /** Recording hard cap in seconds (default 180 — the original behavior). */
  maxSeconds?: number;
  /** Optional error side-channel so a parent can react to persistent
   *  failures (e.g. hide the mic and offer the typed path). */
  onError?: (info: VoiceRecorderError) => void;
  /** Optional recording-state notification for parent-driven UI. */
  onRecordingChange?: (recording: boolean) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (capRef.current) clearTimeout(capRef.current);
    timerRef.current = null;
    capRef.current = null;
  }

  // Release the microphone if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      clearTimers();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function upload(blob: Blob) {
    setState("uploading");
    try {
      const form = new FormData();
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      form.append("audio", blob, `voice-note.${ext}`);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        const message =
          (data.error && ERROR_MESSAGES[data.error]) ??
            "Couldn't transcribe the recording. Try again, or type your observation.";
        setError(message);
        onError?.({ code: data.error ?? null, message });
        return;
      }
      onTranscript(data.text);
      onError?.({ code: null, message: "" });
    } catch {
      const message = "Network error while uploading. Check your connection and try again.";
      setError(message);
      onError?.({ code: null, message });
    } finally {
      setState("idle");
      onRecordingChange?.(false);
    }
  }

  async function start() {
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const message =
        "The microphone needs a secure connection. Open the app via https:// or http://localhost.";
      setError(message);
      onError?.({ code: "INSECURE_CONTEXT", message });
      return;
    }
    const mimeType = pickMimeType();
    if (!mimeType) {
      const message = "This browser can't record audio. Type your observation instead.";
      setError(message);
      onError?.({ code: "NO_RECORDER", message });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      const message = "Microphone access was blocked. Allow it in your browser settings to record.";
      setError(message);
      onError?.({ code: "MIC_BLOCKED", message });
      return;
    }
    streamRef.current = stream;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      clearTimers();
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
      if (blob.size > 0) void upload(blob);
      else setState("idle");
    };
    recorder.start();
    setSeconds(0);
    setState("recording");
    onRecordingChange?.(true);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    // Hard cap so a forgotten recording can't grow past the upload limit.
    capRef.current = setTimeout(stop, maxSeconds * 1000);
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {state === "recording" ? (
          <Button type="button" variant="destructive" onClick={stop} className="h-11">
            <Square className="size-4" aria-hidden />
            Stop recording
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={start}
            disabled={disabled || state === "uploading"}
            className="h-11"
          >
            {state === "uploading" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Mic className="size-4" aria-hidden />
            )}
            {state === "uploading" ? "Transcribing…" : "Record voice note"}
          </Button>
        )}
        {state === "recording" && (
          <span className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground" aria-live="polite">
            <span className="size-2 animate-pulse rounded-full bg-red-500" aria-hidden />
            {fmt(seconds)} / {fmt(maxSeconds)}
          </span>
        )}
      </div>
      {error && (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
