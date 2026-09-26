"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Keyboard,
  Mic,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { CrisisPanel } from "@/components/msaada/CrisisPanel";
import { TriageResultCard } from "@/components/msaada/TriageResultCard";
import {
  VoiceRecorder,
  type VoiceRecorderError,
} from "@/components/msaada/VoiceRecorder";
import {
  STAGE_COPY,
  missingInfoFor,
} from "@/components/msaada/voice-capture-copy";
import type { EncounterDTO, HouseholdDTO } from "@/lib/identity-types";
import type { TriageRecordDTO } from "@/lib/types";
import { queueDraft, removeDraft } from "@/lib/sync/draft-queue";

/**
 * Voice-first AI encounter capture (MVP-46) — the pitch's "wow moment":
 * press Record → speak naturally (Kiswahili / Sheng / English / code-switch)
 * → transcript is shown for correction → Qwen extracts structured
 * observations → the deterministic safety engine routes → the CHV confirms.
 *
 * Mounted by /households over a just-started encounter. The existing typed
 * path on / (SubmissionForm) stays untouched as the fallback.
 *
 * Degradation is honest: no ASR on the provider (501) or no Qwen key (503)
 * auto-opens the typed path with an actionable explanation — triage still
 * completes either way. Draft queue semantics match SubmissionForm:
 * metadata only (never audio, never free text).
 */

type Phase = "idle" | "voice" | "review" | "analyzing" | "result";
type MicAvailability = "unknown" | "unavailable";

/** Persistent failures → hide the mic for the session and open the typed path. */
const PERSISTENT_MIC_CODES = new Set([
  "AI_NOT_CONFIGURED",
  "ASR_NOT_AVAILABLE",
  "UNSUPPORTED_AUDIO_TYPE",
  "NO_RECORDER",
  "INSECURE_CONTEXT",
  "MIC_BLOCKED",
]);

const ANALYZE_MIN_CHARS = 10;
const MAX_AUDIO_BYTES = 4_000_000; // stays under Vercel's ~4.5MB platform cap

export interface VoiceEncounterCaptureProps {
  encounter: EncounterDTO;
  /** County/ward defaults (from the households list on the page). */
  household?: HouseholdDTO;
  onClose: () => void;
  /** Non-crisis success — the page closes the sheet and refreshes. */
  onSaved: (record: TriageRecordDTO) => void;
  /** escalation === true — the page unmounts this sheet and shows CrisisPanel. */
  onCrisis: (record: TriageRecordDTO) => void;
  /** 401 anywhere. */
  onLogout: () => void;
}

export function VoiceEncounterCapture({
  encounter,
  household,
  onClose,
  onSaved,
  onCrisis,
  onLogout,
}: VoiceEncounterCaptureProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [micAvailable, setMicAvailable] = useState<MicAvailability>("unknown");
  const [transcript, setTranscript] = useState("");
  const [record, setRecord] = useState<TriageRecordDTO | null>(null);
  const [policy, setPolicy] = useState<{
    followUpRequired?: boolean;
    followUpDueHours?: number | null;
    referralPriority?: string | null;
  } | null>(null);
  const [referralId, setReferralId] = useState<string | null>(null);
  const [draftUuid, setDraftUuid] = useState<string | null>(null);
  const [offlineQueued, setOfflineQueued] = useState(false);
  const [stage, setStage] = useState<"extract" | "safety" | "slow">("extract");
  const [progress, setProgress] = useState(0);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const stageClock = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  const county = household?.county ?? "Kilifi";
  const ward = household?.ward ?? undefined;

  // Scroll lock while the sheet is open.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // Escape closes only in safe phases (never mid-recording/analyzing).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "idle" || phase === "review" || phase === "result") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, onClose]);

  // Staged-progress clock for the analyzing phase (timed against real chain
  // budgets: p50 ≈ 8s, worst ≈ 30s). Each stage displays at least 1.2s.
  const stopStageClock = useCallback(() => {
    if (stageClock.current) clearInterval(stageClock.current);
    stageClock.current = null;
  }, []);
  useEffect(() => stopStageClock, [stopStageClock]);

  function beginAnalyzeClock() {
    startedAt.current = Date.now();
    setStage("extract");
    setProgress(45);
    stopStageClock();
    stageClock.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt.current) / 1000;
      if (elapsed >= 10) {
        setStage("slow");
        setProgress(92);
      } else if (elapsed >= 4) {
        setStage("safety");
        setProgress(78);
      }
    }, 500);
  }

  function handleRecorderError(info: VoiceRecorderError) {
    if (info.code && PERSISTENT_MIC_CODES.has(info.code)) {
      setMicAvailable("unavailable");
      if (phase === "idle" || phase === "voice") {
        setPhase("review");
        if (info.code === "ASR_NOT_AVAILABLE") {
          toast.error("Voice not available on this AI provider", {
            description:
              "The provider hosts text models only. Type your observation instead — triage still works.",
          });
        } else if (info.code === "AI_NOT_CONFIGURED") {
          toast.error("Voice not set up on this server", {
            description:
              "Type your observation instead — triage still works.",
          });
        }
      }
      return;
    }
    if (info.code === "NO_SPEECH_DETECTED") {
      toast.error("No speech detected", {
        description: "Try again a little closer to the microphone.",
      });
      setPhase("voice");
    } else if (info.code === "TRANSCRIBE_TIMEOUT") {
      toast.error("Transcription took too long", {
        description: "Try a shorter recording, or type it instead.",
      });
    } else if (info.code === "RATE_LIMITED") {
      toast.error("Too many recordings", {
        description: "Wait a minute and try again.",
      });
    } else if (info.message) {
      toast.error("Couldn't transcribe", { description: info.message });
    }
  }

  function handleTranscript(text: string) {
    setTranscript(text);
    setPhase("review");
    toast.success("Voice note transcribed", {
      description: "Check the text and correct anything misheard.",
    });
  }

  async function analyse() {
    const text = transcript.trim();
    if (text.length < ANALYZE_MIN_CHARS) return;
    setAnalyzeError(null);
    setSubmitting(true);
    setOfflineQueued(false);
    setPhase("analyzing");

    // Write-ahead draft (metadata only — never audio, never free text),
    // identical to SubmissionForm's offline semantics.
    const draft = queueDraft({
      encounterId: encounter.id,
      encounterCode: encounter.encounterCode,
      county,
      ward: ward ?? null,
    });
    const draftUuidLocal = draft?.clientUuid ?? null;
    if (draftUuidLocal) {
      setDraftUuid(draftUuidLocal);
      setOfflineQueued(true);
    }

    beginAnalyzeClock();
    const clock = startedAt.current;

    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation_text: text,
          county,
          ward,
          encounterId: encounter.id,
        }),
      });
      if (res.status === 401) {
        toast.error("Session expired", { description: "Please sign in again." });
        onLogout();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (res.status === 429) {
        const retryAfter = (data.retryAfter as number) ?? 60;
        toast.error("Too many submissions", {
          description: `Please wait ${retryAfter}s before trying again.`,
        });
        setPhase("review");
        return;
      }
      if (!res.ok) {
        toast.error("Triage failed", {
          description:
            (data.error as string) === "TRIAGE_FAILED"
              ? "The observation was not stored. Try again."
              : "The observation was not stored. Check the form and try again.",
        });
        setPhase("review");
        return;
      }

      // Success — drop the draft marker.
      if (draftUuidLocal) removeDraft(draftUuidLocal);
      setOfflineQueued(false);
      stopStageClock();

      const record = data as unknown as TriageRecordDTO & {
        policyDecision?: {
          followUpRequired?: boolean;
          followUpDueHours?: number | null;
          referralPriority?: string | null;
        };
        referralId?: string | null;
      };
      setPolicy(record.policyDecision ?? null);
      setReferralId(record.referralId ?? null);

      // Keep the staged animation visible for a beat on fast responses.
      const elapsed = Date.now() - clock;
      if (elapsed < 600) await new Promise((r) => setTimeout(r, 600 - elapsed));

      if (record.escalation === true) {
        onCrisis(record);
        return;
      }
      setRecord(record);
      setProgress(100);
      setPhase("result");
      toast.success("Triage complete", {
        description: record.classification.replace(/_/g, " "),
      });
    } catch {
      toast.error("Network error", {
        description:
          "Could not reach the triage service. Your draft is saved on this device.",
      });
      setAnalyzeError(
        "Network error — your text is preserved below. Try again when back online."
      );
      setPhase("review");
    } finally {
      setSubmitting(false);
      stopStageClock();
    }
  }

  function resetForSameMember() {
    setRecord(null);
    setPolicy(null);
    setReferralId(null);
    setTranscript("");
    setAnalyzeError(null);
    setProgress(0);
    setPhase(micAvailable === "unavailable" ? "review" : "idle");
  }

  const missingInfo = record ? missingInfoFor(record) : [];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vec-title"
        onClick={() => {
          if (phase === "idle" || phase === "review" || phase === "result")
            onClose();
        }}
      >
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-background shadow-2xl sm:m-4 sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-5">
            <div className="min-w-0">
              <p className="text-base font-semibold text-foreground sm:text-lg">
                Record the visit{" "}
                <span lang="sw" className="text-muted-foreground">
                  · Rekodi tembeleo
                </span>
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                Observation for: {encounter.memberDisplayName} ·{" "}
                {encounter.householdLabel} ·{" "}
                <span className="font-mono">{encounter.encounterCode}</span>
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={phase === "analyzing"}
              className="size-9 shrink-0 p-0 text-muted-foreground"
              aria-label="Close capture sheet"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>

          <div className="space-y-4 px-4 py-4 sm:px-5">
            {/* Stage strip */}
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              {phase === "analyzing" ? (
                <span lang="sw">{STAGE_COPY[stage].sw}</span>
              ) : phase === "result" ? (
                <span>Observation analysed · Uchunguzi umechambuliwa</span>
              ) : (
                <span>
                  Speak naturally for 20–30 seconds — Kiswahili, Sheng or
                  English.
                </span>
              )}
            </div>

            {/* ---------------- IDLE ---------------- */}
            {phase === "idle" && (
              <div className="space-y-3">
                {micAvailable !== "unavailable" && (
                  <Button
                    type="button"
                    onClick={() => setPhase("voice")}
                    className="h-14 min-h-[44px] w-full bg-emerald-600 text-base text-white hover:bg-emerald-700"
                  >
                    <Mic className="size-5" aria-hidden />
                    Record voice note · Rekodi sauti
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPhase("review")}
                  className="h-11 min-h-[44px] w-full"
                >
                  <Keyboard className="size-4" aria-hidden />
                  or type instead · au andika badala yake
                </Button>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The recording is transcribed, shown to you, then discarded —
                  it is never stored.{" "}
                  <span lang="sw">
                    Rekodi inatafsiriwa, kuonyeshwa kwako, kisha hutupwa —
                    hihifadhiwi kamwe.
                  </span>
                </p>
              </div>
            )}

            {/* ---------------- VOICE ---------------- */}
            {phase === "voice" && (
              <div className="space-y-3">
                <VoiceRecorder
                  onTranscript={handleTranscript}
                  maxSeconds={90}
                  onError={handleRecorderError}
                />
                <p className="text-xs text-muted-foreground">
                  Speak clearly, describe behaviours only — no names or
                  addresses.{" "}
                  <span lang="sw">
                    Zungumza wazi, eleza tabia tu — bila majina au anwani.
                  </span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPhase("review")}
                  className="h-11 min-h-[44px] w-full"
                >
                  <Keyboard className="size-4" aria-hidden />
                  or type instead
                </Button>
              </div>
            )}

            {/* ---------------- REVIEW ---------------- */}
            {phase === "review" && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  Check the transcript{" "}
                  <span lang="sw" className="text-muted-foreground">
                    · Angalia maandishi
                  </span>
                </p>
                <Textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={6}
                  className="min-h-44 text-base"
                  placeholder="Your transcript appears here — you can also type or paste one."
                  aria-label="Observation text"
                />
                <p className="text-xs text-muted-foreground">
                  Speech may mix Kiswahili, Sheng and English — correct anything
                  misheard before analysing.
                </p>
                {analyzeError && (
                  <p
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                    role="alert"
                  >
                    {analyzeError}
                  </p>
                )}
                {offlineQueued && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    Draft marker saved on this device — it syncs automatically
                    when you are back online.
                  </p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    onClick={analyse}
                    disabled={submitting || transcript.trim().length < ANALYZE_MIN_CHARS}
                    className="h-11 min-h-[44px] flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    Analyse observation · Chambua uchunguzi
                    <ArrowRight className="size-4" aria-hidden />
                  </Button>
                  {micAvailable !== "unavailable" && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setTranscript("");
                        setPhase("voice");
                      }}
                      className="h-11 min-h-[44px]"
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      Record again
                    </Button>
                  )}
                </div>
                {transcript.trim().length < ANALYZE_MIN_CHARS && (
                  <p className="text-xs text-muted-foreground">
                    A little more detail is needed — at least {ANALYZE_MIN_CHARS}{" "}
                    characters.{" "}
                    <span lang="sw">Ongeza maelezo kidogo — angalau herufi 10.</span>
                  </p>
                )}
              </div>
            )}

            {/* ---------------- ANALYZING ---------------- */}
            {phase === "analyzing" && (
              <div className="space-y-4 py-6">
                <Progress value={progress} aria-label="Triage progress" />
                <div className="space-y-1 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {STAGE_COPY[stage].en}
                  </p>
                  <p lang="sw" className="text-xs text-muted-foreground">
                    {STAGE_COPY[stage].sw}
                  </p>
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Qwen structures the observation; the deterministic safety
                  engine decides the routing — the model never overrides it.
                </p>
              </div>
            )}

            {/* ---------------- RESULT ---------------- */}
            {phase === "result" && record && (
              <div className="space-y-4">
                {(policy?.followUpRequired || referralId) && (
                  <div className="flex flex-wrap gap-2">
                    {policy?.followUpRequired && (
                      <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        Follow-up scheduled · due in{" "}
                        {policy.followUpDueHours ?? 48}h ·{" "}
                        <span lang="sw">Ufuatilio umepangwa</span>
                      </span>
                    )}
                    {referralId && (
                      <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        Referral created
                        {policy?.referralPriority
                          ? ` · ${policy.referralPriority}`
                          : ""}{" "}
                        · <span lang="sw">Rufaa imeundwa</span>
                      </span>
                    )}
                  </div>
                )}
                <TriageResultCard record={record} onSubmitAnother={resetForSameMember} />
                {missingInfo.length > 0 && (
                  <div className="rounded-lg border border-border bg-card px-4 py-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Sparkles className="size-4 text-teal-600" aria-hidden />
                      To complete this picture ·{" "}
                      <span lang="sw">Kukamilisha picha hii</span>
                    </p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                      {missingInfo.map((item) => (
                        <li key={item.en}>
                          <span lang="sw">{item.sw}</span> — {item.en}
                        </li>
                      ))}
                    </ol>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      AI suggestion · use your own judgement ·{" "}
                      <span lang="sw">Mapendekezo ya AI · tumia uamuzi wako</span>
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  AI-suggested visit questions appear in Follow-ups after this
                  save.{" "}
                  <span lang="sw">
                    Maswali ya ufuatilio yataonekana kwenye Follow-ups baada ya
                    kuhifadhi.
                  </span>
                </p>
                <Button
                  type="button"
                  onClick={() => onSaved(record)}
                  className="h-11 min-h-[44px] w-full bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Done — save and close · Nimemaliza
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>

      {/* Crisis override: escalation records never reach `result` — this
          sheet calls onCrisis(record) and the PAGE mounts CrisisPanel
          first-in-tree so it always wins z-index (pattern from page.tsx). */}
    </>
  );
}
