"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ChevronDown,
  ExternalLink,
  Loader2,
  LogOut,
  Lock,
  Mic,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { COUNTIES, WARDS, type County, type TriageRecordDTO } from "@/lib/types";
import { SAMPLE_TRANSCRIPTS } from "./samples";
import { TriageResultCard } from "./TriageResultCard";
import type { Chv } from "./AuthCard";

type Status = "idle" | "loading" | "result" | "error";

interface SubmissionFormProps {
  chv: Chv;
  onLogout: () => void;
  onDashboard: () => void;
  onCrisis: (record: TriageRecordDTO) => void;
  /** Fired after any successful triage write (crisis or normal) so the parent can refresh downstream panels. */
  onResult: (record: TriageRecordDTO) => void;
  postCrisisBanner: string | null;
  onClearPostCrisisBanner: () => void;
}

export function SubmissionForm({
  chv,
  onLogout,
  onDashboard,
  onCrisis,
  onResult,
  postCrisisBanner,
  onClearPostCrisisBanner,
}: SubmissionFormProps) {
  const [county, setCounty] = useState<County>(
    (COUNTIES as readonly string[]).includes(chv.county)
      ? (chv.county as County)
      : "Kilifi"
  );
  const [ward, setWard] = useState<string>(chv.ward ?? "");
  const [observation, setObservation] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [sampleId, setSampleId] = useState<string>("");

  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<TriageRecordDTO | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const wardsForCounty = useMemo(() => WARDS[county] ?? [], [county]);

  function handleCountyChange(v: string) {
    setCounty(v as County);
    setWard("");
  }

  function handleSampleSelect(id: string) {
    setSampleId(id);
    const found = SAMPLE_TRANSCRIPTS.find((s) => s.id === id);
    if (found) {
      setObservation(found.text);
      toast.info(`Loaded sample: ${found.label.replace(/^⚠\s*/, "")}`);
    }
  }

  function resetForAnother() {
    setResult(null);
    setStatus("idle");
    setInlineError(null);
    setObservation("");
    setVoiceTranscript("");
    setSampleId("");
    onClearPostCrisisBanner();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInlineError(null);

    if (!observation.trim() && !voiceTranscript.trim()) {
      const msg = "Please describe what you observed before submitting.";
      setInlineError(msg);
      toast.error(msg);
      return;
    }
    if (!county) {
      const msg = "Select a county.";
      setInlineError(msg);
      toast.error(msg);
      return;
    }

    // prepend voice transcript to observation text if provided
    const combined = [voiceTranscript.trim(), observation.trim()]
      .filter(Boolean)
      .join("\n\n");

    setStatus("loading");
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation_text: combined,
          county,
          ward: ward || undefined,
        }),
      });
      const data = (await res.json()) as TriageRecordDTO | { error: string };

      if (res.status === 401) {
        toast.error("Session expired", { description: "Please sign in again." });
        onLogout();
        return;
      }
      if (res.status === 429) {
        const retry = (data as { retryAfter?: number }).retryAfter ?? 60;
        const msg = `Too many submissions. Please wait ${retry}s before trying again.`;
        setInlineError(msg);
        toast.error("Rate limited", { description: msg });
        setStatus("error");
        return;
      }
      if (!res.ok || "error" in data) {
        const errMsg =
          (data as { error?: string }).error ??
          "Triage failed. Please try again.";
        setInlineError(errMsg);
        toast.error("Triage failed", { description: errMsg });
        setStatus("error");
        return;
      }

      const record = data as TriageRecordDTO;

      // Crisis override: hand off to the page-level CrisisPanel
      // immediately. Do NOT render the normal result card for a crisis
      // record — the CrisisPanel renders first in the tree and is the
      // only way the CHV can clear the state.
      if (record.escalation) {
        toast.success("Crisis override triggered", {
          description: "Escalation panel shown — call the crisis line now.",
        });
        // Reset the form to idle so that when the CHV confirms the
        // non-dismissable crisis panel, the submission form is immediately
        // usable again and the post-crisis banner shows above it. While the
        // panel is on screen (fixed inset-0 z-50) the form beneath is
        // covered anyway.
        setStatus("idle");
        setResult(null);
        setObservation("");
        setVoiceTranscript("");
        setSampleId("");
        onResult(record);
        onCrisis(record);
        return;
      }

      setStatus("result");
      setResult(record);
      onResult(record);
      toast.success("Triage complete", {
        description: record.classification.replace(/_/g, " "),
      });
    } catch {
      const msg = "Network error — could not reach the triage service.";
      setInlineError(msg);
      toast.error(msg);
      setStatus("error");
    }
  }

  return (
    <div className="w-full max-w-2xl">
      {/* ---- Top bar ---- */}
      <header className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">
            Msaada <span className="text-muted-foreground font-normal">— CHV visit observation</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {chv.fullName} · {chv.county}
            {chv.ward ? `, ${chv.ward}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={onDashboard}>
          View dashboard <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-muted-foreground"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" /> Log out
        </Button>
      </header>

      {/* ---- Post-crisis banner ---- */}
      {postCrisisBanner && status !== "loading" && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4"
        >
          <Alert className="border-emerald-300 bg-emerald-50 text-emerald-900">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Crisis record logged for reporting</AlertTitle>
            <AlertDescription className="flex items-start justify-between gap-3">
              <span>{postCrisisBanner}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 border-emerald-400 text-emerald-900 hover:bg-emerald-100"
                onClick={onClearPostCrisisBanner}
              >
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        </motion.div>
      )}

      {/* ---- Loading skeleton ---- */}
      {status === "loading" && (
        <Card className="border-emerald-100">
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-8 w-32 rounded-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}

      {/* ---- Result card (non-crisis) ---- */}
      {status === "result" && result && (
        <TriageResultCard record={result} onSubmitAnother={resetForAnother} />
      )}

      {/* ---- Error inline banner ---- */}
      {status === "error" && inlineError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Triage failed</AlertTitle>
          <AlertDescription>{inlineError}</AlertDescription>
        </Alert>
      )}

      {/* ---- Submission form (idle + error states render this; loading + result hide it) ---- */}
      {(status === "idle" || status === "error") && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          <Card className="border-emerald-100 shadow-sm">
            <CardHeader>
              <CardTitle>Submit visit observation</CardTitle>
              <CardDescription>
                Describe the household member&apos;s behaviours — the model
                classifies them into a triage level and a CHP next action.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* County + Ward */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="county">County</Label>
                    <Select value={county} onValueChange={handleCountyChange}>
                      <SelectTrigger id="county" className="min-h-11 w-full">
                        <SelectValue placeholder="Select county" />
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ward">Ward</Label>
                    <Select value={ward} onValueChange={setWard}>
                      <SelectTrigger id="ward" className="min-h-11 w-full">
                        <SelectValue placeholder="Select ward" />
                      </SelectTrigger>
                      <SelectContent>
                        {wardsForCounty.map((w) => (
                          <SelectItem key={w} value={w}>
                            {w}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Sample transcript picker */}
                <div className="space-y-1.5">
                  <Label htmlFor="sample">Use a sample transcript</Label>
                  <Select value={sampleId} onValueChange={handleSampleSelect}>
                    <SelectTrigger id="sample" className="min-h-11 w-full">
                      <SelectValue placeholder="Pick a pre-written sample to auto-fill" />
                    </SelectTrigger>
                    <SelectContent>
                      {SAMPLE_TRANSCRIPTS.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Useful for judges — includes one explicit crisis statement
                    to demonstrate the crisis panel.
                  </p>
                </div>

                {/* Observation textarea */}
                <div className="space-y-1.5">
                  <Label htmlFor="observation">
                    What did you observe during this visit?
                  </Label>
                  <Textarea
                    id="observation"
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    rows={6}
                    placeholder="Describe behaviours only — sleep, appetite, withdrawal, distress…"
                    className="min-h-44"
                  />
                  <p className="text-xs text-muted-foreground">
                    Describe behaviours only — sleep, appetite, withdrawal,
                    distress. Do NOT include household names or addresses.
                  </p>
                </div>

                {/* Collapsible voice transcript */}
                <Collapsible open={voiceOpen} onOpenChange={setVoiceOpen}>
                  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Mic className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="text-sm font-medium">
                        Paste voice transcript
                      </span>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-9">
                        {voiceOpen ? "Hide" : "Show"}
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${voiceOpen ? "rotate-180" : ""}`}
                        />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="mt-2 space-y-1.5">
                    <Textarea
                      value={voiceTranscript}
                      onChange={(e) => setVoiceTranscript(e.target.value)}
                      rows={3}
                      placeholder="Paste a transcript here if you recorded a voice note…"
                      className="min-h-24"
                    />
                    <p className="text-xs text-muted-foreground">
                      Voice-to-text is stubbed for the demo; paste a transcript
                      here if you recorded a voice note. If filled, its content
                      is prepended to the observation text sent to the model.
                    </p>
                  </CollapsibleContent>
                </Collapsible>

                {/* Submit */}
                <div className="space-y-2">
                  <Button
                    type="submit"
                    disabled={status === "loading"}
                    className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
                  >
                    {status === "loading" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Submitting…
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Submit observation
                      </>
                    )}
                  </Button>
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>
                      Your raw observation text is sent to the model for
                      classification but is NOT stored. Only the structured
                      triage result and county/ward are saved.
                    </span>
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
