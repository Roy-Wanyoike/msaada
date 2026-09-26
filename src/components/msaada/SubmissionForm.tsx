"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ChevronDown,
  CloudOff,
  Loader2,
  Lock,
  Mic,
  PencilLine,
  PlayCircle,
  Send,
  ShieldCheck,
  UserRound,
  Users,
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
import {
  flushDrafts,
  queueDraft,
  removeDraft,
} from "@/lib/sync/draft-queue";
import type {
  EncounterDTO,
  HouseholdDTO,
  HouseholdMemberDTO,
} from "@/lib/identity-types";
import { SAMPLE_TRANSCRIPTS } from "./samples";
import { TriageResultCard } from "./TriageResultCard";
import { VoiceRecorder } from "./VoiceRecorder";
import type { Chv } from "./AuthCard";

type Status = "idle" | "loading" | "result" | "error";

interface SubmissionFormProps {
  chv: Chv;
  onLogout: () => void;
  onCrisis: (record: TriageRecordDTO) => void;
  /** Fired after any successful triage write (crisis or normal) so the parent can refresh downstream panels. */
  onResult: (record: TriageRecordDTO) => void;
  postCrisisBanner: string | null;
  onClearPostCrisisBanner: () => void;
}

export function SubmissionForm({
  chv,
  onLogout,
  onCrisis,
  onResult,
  postCrisisBanner,
  onClearPostCrisisBanner,
}: SubmissionFormProps) {
  // --- Identity-chain state (Household → Member → Encounter, §6/§15/§25) ---
  const [households, setHouseholds] = useState<HouseholdDTO[]>([]);
  const [householdsLoading, setHouseholdsLoading] = useState(true);
  const [householdsError, setHouseholdsError] = useState<string | null>(null);

  const [householdId, setHouseholdId] = useState<string>("");
  const [members, setMembers] = useState<HouseholdMemberDTO[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberId, setMemberId] = useState<string>("");

  const [encounter, setEncounter] = useState<EncounterDTO | null>(null);
  const [startingEncounter, setStartingEncounter] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  // --- Triage form state (existing) -------------------------------------
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

  /** True while a submitted draft is stuck in the offline queue (#18). */
  const [offlineDraftSaved, setOfflineDraftSaved] = useState(false);

  const wardsForCounty = useMemo(() => WARDS[county] ?? [], [county]);

  // --- Helpers ----------------------------------------------------------

  /**
   * Fetch a household + its members. Returns the household's county/ward so
   * the caller can default the demographic-scoping selects (§25 — encounter
   * gives the identity, county/ward gives the aggregate bucket).
   */
  const loadHouseholdDetail = useCallback(
    async (
      hid: string
    ): Promise<{ county: string | null; ward: string | null } | null> => {
      setMembersLoading(true);
      setIdentityError(null);
      try {
        const res = await fetch(
          `/api/households/${encodeURIComponent(hid)}`,
          { cache: "no-store" }
        );
        if (res.status === 401) {
          onLogout();
          return null;
        }
        if (!res.ok) throw new Error("request_failed");
        const data = (await res.json()) as {
          household: {
            id: string;
            county: string;
            ward: string | null;
            label: string;
            householdCode: string;
          } | null;
          members: HouseholdMemberDTO[];
        };
        setMembers(data.members ?? []);
        return {
          county: data.household?.county ?? null,
          ward: data.household?.ward ?? null,
        };
      } catch {
        setIdentityError("Could not load household members.");
        setMembers([]);
        return null;
      } finally {
        setMembersLoading(false);
      }
    },
    [onLogout]
  );

  // --- Load households list on mount (always — for the selector) --------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHouseholdsLoading(true);
      setHouseholdsError(null);
      try {
        const res = await fetch("/api/households", { cache: "no-store" });
        if (res.status === 401) {
          onLogout();
          return;
        }
        if (!res.ok) throw new Error("request_failed");
        const data = (await res.json()) as { households: HouseholdDTO[] };
        if (cancelled) return;
        setHouseholds(data.households ?? []);
      } catch {
        if (cancelled) return;
        setHouseholdsError("Could not load households.");
      } finally {
        if (!cancelled) setHouseholdsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onLogout]);

  // --- URL preselect: ?encounter=ENC_ID set by /households -------------
  // The /households page deep-links here with an encounter already started
  // (spec §25). We resolve it via GET /api/encounters + GET /api/households/[id]
  // (for county/ward defaults + members list, so the "Change" path works).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const encParam = params.get("encounter");
    if (!encParam) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/encounters", { cache: "no-store" });
        if (res.status === 401) {
          onLogout();
          return;
        }
        if (!res.ok) throw new Error("request_failed");
        const data = (await res.json()) as { encounters: EncounterDTO[] };
        if (cancelled) return;
        const found = data.encounters.find(
          (e) => e.id === encParam || e.encounterCode === encParam
        );
        if (!found) {
          setIdentityError(
            "Encounter from URL not found — pick a household/member below."
          );
          return;
        }
        setEncounter(found);
        setHouseholdId(found.householdId);
        setMemberId(found.memberId);
        const hh = await loadHouseholdDetail(found.householdId);
        if (cancelled || !hh) return;
        if (hh.county && (COUNTIES as readonly string[]).includes(hh.county)) {
          setCounty(hh.county as County);
        }
        if (hh.ward) setWard(hh.ward);
      } catch {
        if (cancelled) return;
        setIdentityError("Could not load encounter details from URL.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHouseholdDetail, onLogout]);

  // --- Offline draft sync (#18, rewired by #45) ---------------------------
  // On mount and whenever the device comes back online, push anything still
  // in the offline draft queue to POST /api/encounters/drafts — the app's
  // own cookie-authed endpoint, which mirrors the drafts into the Supabase
  // `encounter_drafts` cloud table server-side. Silent unless something
  // actually synced — a false "synced" message when the session expired or
  // Supabase is unconfigured would be dishonest.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const res = await flushDrafts();
      if (!cancelled && res.flushed > 0) {
        toast.success(
          `Synced ${res.flushed} saved draft${res.flushed === 1 ? "" : "s"}`
        );
      }
    };
    void sync();
    window.addEventListener("online", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("online", sync);
    };
  }, []);

  // --- Identity chain handlers -----------------------------------------

  async function handleHouseholdChange(hid: string) {
    setHouseholdId(hid);
    setMemberId("");
    setMembers([]);
    if (!hid) return;
    const hh = await loadHouseholdDetail(hid);
    if (hh) {
      if (
        hh.county &&
        (COUNTIES as readonly string[]).includes(hh.county)
      ) {
        setCounty(hh.county as County);
      }
      if (hh.ward) setWard(hh.ward);
    }
  }

  async function handleStartEncounter() {
    if (!householdId || !memberId) return;
    setStartingEncounter(true);
    setIdentityError(null);
    try {
      const res = await fetch("/api/encounters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId, memberId }),
      });
      if (res.status === 401) {
        toast.error("Session expired", { description: "Please sign in again." });
        onLogout();
        return;
      }
      const data = (await res.json()) as EncounterDTO | { error: string };
      if (!res.ok || "error" in data) {
        const errMsg =
          (data as { error?: string }).error ?? "Could not start encounter.";
        setIdentityError(errMsg);
        toast.error("Start encounter failed", { description: errMsg });
        return;
      }
      const enc = data as EncounterDTO;
      setEncounter(enc);
      toast.success("Encounter started", {
        description: `${enc.encounterCode} · ${enc.memberDisplayName}`,
      });
    } catch {
      setIdentityError("Network error — could not start encounter.");
      toast.error("Network error", {
        description: "Could not start encounter.",
      });
    } finally {
      setStartingEncounter(false);
    }
  }

  function handleChangeEncounter() {
    setEncounter(null);
    setObservation("");
    setVoiceTranscript("");
    setSampleId("");
    setInlineError(null);
    // Keep householdId/memberId/members — the user may want to restart with
    // the same household + a different member, or pick a new household.
    toast.info("Encounter cleared — pick a household/member to start a new one.");
  }

  // --- Existing handlers -----------------------------------------------

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
    // Keep `encounter` so the CHV can log another observation for the same
    // person — an encounter may have many observations (§6). Use "Change"
    // to explicitly clear the encounter and start a new identity chain.
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
    // Defense in depth — the submit button is disabled until an encounter
    // is started, but enforce the §15 invariant server-side too.
    if (!encounter) {
      const msg = "Start an encounter before submitting an observation.";
      setInlineError(msg);
      toast.error(msg);
      return;
    }

    // prepend voice transcript to observation text if provided
    const combined = [voiceTranscript.trim(), observation.trim()]
      .filter(Boolean)
      .join("\n\n");

    // --- Offline-ready draft queue (#18, #45) -----------------------------
    // Write-ahead: queue the draft BEFORE the network attempt. The payload
    // is structured metadata only — raw observation free-text is never
    // persisted (project de-identification rule, on-device or in the cloud).
    // On success the entry is removed; on any failure it stays queued and is
    // synced via POST /api/encounters/drafts on mount / window "online".
    setOfflineDraftSaved(false);
    const draftEntry = queueDraft({
      encounterId: encounter.id,
      encounterCode: encounter.encounterCode,
      county,
      ward: ward || undefined,
    });

    setStatus("loading");
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation_text: combined,
          county,
          ward: ward || undefined,
          encounterId: encounter.id,
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
        // Keep the draft queued — it syncs automatically later (#18).
        setOfflineDraftSaved(true);
        setStatus("error");
        return;
      }
      if (!res.ok || "error" in data) {
        const errMsg =
          (data as { error?: string }).error ??
          "Triage failed. Please try again.";
        setInlineError(errMsg);
        toast.error("Triage failed", { description: errMsg });
        // Keep the draft queued — it syncs automatically later (#18).
        setOfflineDraftSaved(true);
        setStatus("error");
        return;
      }

      const record = data as TriageRecordDTO;

      // The observation reached the server — drop its draft from the queue.
      if (draftEntry) removeDraft(draftEntry.clientUuid);
      setOfflineDraftSaved(false);

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
        // Keep the encounter so the follow-up / referral recorded against
        // this person is traceable; "Change" remains available afterwards.
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
      // Offline / unreachable — keep the draft queued and tell the CHV
      // honestly that it is saved and will sync automatically (#18).
      setOfflineDraftSaved(true);
      setStatus("error");
    }
  }

  // --- Derived labels for the confirmation banner ----------------------
  const encounterCode = encounter?.encounterCode ?? "—";
  const memberName = encounter?.memberDisplayName ?? "—";
  const householdLabel = encounter?.householdLabel ?? "—";

  return (
    <div className="w-full">
      {/* Identity, navigation and sign-out live in the app shell (AppNav). */}

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

      {/* ---- Offline draft note (issue #18) ------------------------------ */}
      {offlineDraftSaved && status !== "loading" && status !== "result" && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4"
        >
          <Alert className="border-amber-300 bg-amber-50 text-amber-900">
            <CloudOff className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Draft saved on this device</AlertTitle>
            <AlertDescription>
              Saved offline — will sync automatically when you&apos;re back
              online. Only structured metadata is kept — never raw observation
              text.
            </AlertDescription>
          </Alert>
        </motion.div>
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
                {/* ---- Identity confirmation banner (§25) ----
                    Shown whenever an encounter is active. The "Change" link
                    clears the encounter and re-shows the identity selector. */}
                {encounter && (
                  <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
                    <Users className="h-4 w-4" aria-hidden="true" />
                    <AlertDescription className="flex items-start justify-between gap-3">
                      <span className="text-sm leading-relaxed">
                        <span className="font-semibold">Observation for:</span>{" "}
                        {memberName} · {householdLabel} ·{" "}
                        <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-xs">
                          {encounterCode}
                        </code>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 text-emerald-900 hover:bg-emerald-100"
                        onClick={handleChangeEncounter}
                      >
                        <PencilLine className="h-3.5 w-3.5" /> Change
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {/* ---- Identity selector (§15 — never create an observation
                        without knowing which member it concerns) ---- */}
                {!encounter && (
                  <div className="space-y-4 rounded-lg border border-dashed border-muted-foreground/30 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Users className="h-4 w-4" aria-hidden="true" />
                      Identity chain — pick who this observation is for
                    </div>
                    {identityError && (
                      <p className="text-xs text-amber-700">{identityError}</p>
                    )}
                    {householdsError && (
                      <p className="text-xs text-amber-700">
                        {householdsError}
                      </p>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="household">
                          Household
                          <span aria-hidden="true" className="text-rose-600">
                            {" "}
                            *
                          </span>
                        </Label>
                        <Select
                          value={householdId}
                          onValueChange={handleHouseholdChange}
                          disabled={householdsLoading}
                        >
                          <SelectTrigger
                            id="household"
                            className="min-h-11 w-full"
                            aria-required="true"
                          >
                            <SelectValue
                              placeholder={
                                householdsLoading
                                  ? "Loading households…"
                                  : households.length === 0
                                    ? "No households — create one first"
                                    : "Select household"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {households.map((h) => (
                              <SelectItem key={h.id} value={h.id}>
                                {h.label} · {h.householdCode}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="member">
                          Member
                          <span aria-hidden="true" className="text-rose-600">
                            {" "}
                            *
                          </span>
                        </Label>
                        <Select
                          value={memberId}
                          onValueChange={setMemberId}
                          disabled={!householdId || membersLoading}
                        >
                          <SelectTrigger
                            id="member"
                            className="min-h-11 w-full"
                            aria-required="true"
                          >
                            <SelectValue
                              placeholder={
                                !householdId
                                  ? "Pick household first"
                                  : membersLoading
                                    ? "Loading members…"
                                    : members.length === 0
                                      ? "No members in household"
                                      : "Select member"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {members.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.displayName}
                                {m.role ? ` · ${m.role}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button
                      type="button"
                      className="h-11 w-full bg-emerald-600 hover:bg-emerald-700"
                      disabled={
                        !householdId || !memberId || startingEncounter
                      }
                      onClick={handleStartEncounter}
                    >
                      {startingEncounter ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Starting encounter…
                        </>
                      ) : (
                        <>
                          <PlayCircle className="h-4 w-4" />
                          Start encounter
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      <UserRound className="mr-1 inline h-3 w-3" aria-hidden="true" />
                      An encounter is required before logging an observation
                      — never create an observation without knowing which
                      member it concerns (spec §15).
                    </p>
                  </div>
                )}

                {/* County + Ward — kept for aggregate-scoping (spec §25):
                    the encounter provides the identity; the county/ward
                    provides the demographic bucket for dashboard aggregates. */}
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

                {/* Observation textarea — DISABLED until an encounter is
                    started (§15 — observations must be linked to a member). */}
                <div className="space-y-1.5">
                  <Label htmlFor="observation">
                    What did you observe during this visit?
                  </Label>
                  <Textarea
                    id="observation"
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    rows={6}
                    placeholder={
                      encounter
                        ? "Describe behaviours only — sleep, appetite, withdrawal, distress…"
                        : "Start an encounter above to enable this field"
                    }
                    className="min-h-44"
                    disabled={!encounter}
                    aria-required="true"
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
                      <Mic
                        className="h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium">
                        Voice note
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
                  <CollapsibleContent className="mt-2 space-y-2">
                    <VoiceRecorder
                      disabled={!encounter}
                      onTranscript={(text) => {
                        setVoiceTranscript((prev) =>
                          prev.trim() ? `${prev.trim()}\n\n${text}` : text
                        );
                        toast.success("Voice note transcribed", {
                          description: "Check the text below and correct anything misheard.",
                        });
                      }}
                    />
                    <Textarea
                      value={voiceTranscript}
                      onChange={(e) => setVoiceTranscript(e.target.value)}
                      rows={3}
                      placeholder="Your transcript appears here. You can also paste or type one."
                      className="min-h-24"
                      disabled={!encounter}
                      aria-label="Voice note transcript"
                    />
                    <p className="text-xs text-muted-foreground">
                      Speak in Kiswahili, Sheng or English. The recording is
                      transcribed and then discarded; it is never stored.
                      Review the transcript before submitting. It is added to
                      your observation, and names and numbers are scrubbed
                      before triage.
                    </p>
                  </CollapsibleContent>
                </Collapsible>

                {/* Submit — DISABLED until encounter is started */}
                <div className="space-y-2">
                  <Button
                    type="submit"
                    disabled={!encounter}
                    className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
                  >
                    {/* status narrows to "idle" | "error" here — the loading
                        skeleton above replaces this section while submitting. */}
                    {!encounter ? (
                      <>
                        <Lock className="h-4 w-4" />
                        Start an encounter to submit
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Submit observation
                      </>
                    )}
                  </Button>
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Lock
                      className="mt-0.5 h-3 w-3 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      Your raw observation text is sent to the model for
                      classification but is NOT stored. Only the structured
                      triage result, county/ward, and encounter link are saved.
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
