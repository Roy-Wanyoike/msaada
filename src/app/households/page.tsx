"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowRight,
  Building2,
  ChevronDown,
  ChevronUp,
  Home,
  Loader2,
  MapPin,
  Mic,
  Plus,
  RefreshCw,
  Stethoscope,
  TriangleAlert,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { AppNav } from "@/components/msaada/AppNav";
import { CrisisPanel } from "@/components/msaada/CrisisPanel";
import { VoiceEncounterCapture } from "@/components/msaada/VoiceEncounterCapture";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { COUNTIES, WARDS, type County, type TriageRecordDTO } from "@/lib/types";
import type {
  EncounterDTO,
  HouseholdDTO,
  HouseholdMemberDTO,
} from "@/lib/identity-types";

/**
 * `/households` — the CHV's household workflow dashboard.
 *
 * Identity-chain entry point (Household -> Member -> Encounter). The CHV can
 * 1. create a household (county + ward + mnemonic label — NOT a name),
 * 2. view a household's roster of members,
 * 3. add a member (displayName + role + ageBand),
 * 4. start an encounter for a member -> returns an MSD-ENC-XXXX code,
 *    then a one-tap jump to the observation flow on `/` with the encounter
 *    preselected via `?encounter=ENC_ID`.
 *
 * The page reads ONLY from ownership-scoped endpoints — a CHV never sees
 * another CHV's households. All data here is identifier-level (codes, roles,
 * band labels) — never raw observation text.
 */

type LoadState = "loading" | "ready" | "error" | "unauthed";

/** Roles drawn from the Kenya MoH CHV household-roster convention. */
const MEMBER_ROLES = [
  "Head of household",
  "Spouse",
  "Parent",
  "Child",
  "Sibling",
  "Grandparent",
  "Other relative",
  "Visitor",
] as const;

/** Age bands aligned to the MoH iCHV register. */
const AGE_BANDS = [
  "<1 year",
  "1-4 years",
  "5-9 years",
  "10-14 years",
  "15-19 years",
  "20-24 years",
  "25-49 years",
  "50-59 years",
  "60+ years",
] as const;

export default function HouseholdsPage() {
  // ---- List state ---------------------------------------------------------
  const [state, setState] = useState<LoadState>("loading");
  const [households, setHouseholds] = useState<HouseholdDTO[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ---- Selected household detail -----------------------------------------
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<HouseholdMemberDTO[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // ---- "New household" sheet ---------------------------------------------
  const [newOpen, setNewOpen] = useState(false);

  // ---- Recently started encounter confirmation banner --------------------
  const [startedEncounter, setStartedEncounter] = useState<EncounterDTO | null>(
    null
  );

  // ---- Voice-first capture sheet (MVP-46) + crisis override --------------
  // The capture sheet mounts over the just-started encounter; crisis records
  // never reach its result phase — they land here and CrisisPanel renders
  // FIRST in the tree (same ordering rule as src/app/page.tsx).
  const [captureEncounter, setCaptureEncounter] = useState<EncounterDTO | null>(
    null
  );
  const [crisisRecord, setCrisisRecord] = useState<TriageRecordDTO | null>(null);
  const [postCrisisBanner, setPostCrisisBanner] = useState<string | null>(null);

  /** Monotonic fetch counter so stale responses can be dropped. */
  const listReqId = useMemo(() => ({ id: 0 }), []);

  const loadHouseholds = useCallback(async () => {
    const reqId = ++listReqId.id;
    setState((s) => (s === "ready" ? s : "loading"));
    setErrorMsg(null);
    try {
      const res = await fetch("/api/households", { cache: "no-store" });
      if (res.status === 401) {
        setState("unauthed");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { households: HouseholdDTO[] };
      if (reqId !== listReqId.id) return;
      setHouseholds(data.households);
      setState("ready");
    } catch (err) {
      if (reqId !== listReqId.id) return;
      const msg =
        err instanceof Error ? err.message : "Couldn't load households";
      setErrorMsg(msg);
      setState("error");
    }
  }, [listReqId]);

  useEffect(() => {
    void loadHouseholds();
  }, [loadHouseholds]);

  // ---- Detail panel fetch -------------------------------------------------
  const loadMembers = useCallback(async (id: string) => {
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/households/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        household: HouseholdDTO;
        members: HouseholdMemberDTO[];
      };
      setMembers(data.members);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't load members";
      toast.error("Couldn't load household roster", {
        description: msg,
      });
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  const handleSelect = useCallback(
    (h: HouseholdDTO) => {
      // Toggle closed if clicking the open card.
      if (selectedId === h.id) {
        setSelectedId(null);
        setMembers([]);
        return;
      }
      setSelectedId(h.id);
      setMembers([]);
      void loadMembers(h.id);
    },
    [selectedId, loadMembers]
  );

  const handleCreatedHousehold = useCallback(
    (next: HouseholdDTO) => {
      setHouseholds((prev) => [next, ...prev]);
      setSelectedId(next.id);
      setMembers([]);
      void loadMembers(next.id);
    },
    [loadMembers]
  );

  const handleMemberAdded = useCallback((next: HouseholdMemberDTO) => {
    setMembers((prev) => [...prev, next]);
    // Bump the parent household's memberCount in the list state.
    setHouseholds((prev) =>
      prev.map((h) =>
        h.id === next.householdId
          ? { ...h, memberCount: h.memberCount + 1 }
          : h
      )
    );
  }, []);

  const handleEncounterStarted = useCallback((enc: EncounterDTO) => {
    // Bump encounterCount on the household card.
    setHouseholds((prev) =>
      prev.map((h) =>
        h.id === enc.householdId
          ? { ...h, encounterCount: h.encounterCount + 1 }
          : h
      )
    );
    setStartedEncounter(enc);
  }, []);

  // ----- Derived view state -----------------------------------------------
  const totalHouseholds = households.length;
  const totalMembers = households.reduce((s, h) => s + h.memberCount, 0);
  const totalEncounters = households.reduce(
    (s, h) => s + h.encounterCount,
    0
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:pl-64 print:pl-0">
      <AppNav />

      <main id="main" className="flex-1" tabIndex={-1}>
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <HouseholdsHeader
            totalHouseholds={totalHouseholds}
            totalMembers={totalMembers}
            totalEncounters={totalEncounters}
            onRefresh={() => void loadHouseholds()}
            onNew={() => setNewOpen(true)}
          />

          {state === "loading" ? (
            <HouseholdsSkeleton />
          ) : state === "unauthed" ? (
            <UnauthedState />
          ) : state === "error" ? (
            <ErrorState
              message={errorMsg ?? "Unknown error"}
              onRetry={() => void loadHouseholds()}
            />
          ) : totalHouseholds === 0 ? (
            <EmptyState onNew={() => setNewOpen(true)} />
          ) : (
            <section
              aria-label="Household list"
              aria-live="polite"
              className="space-y-3"
            >
              {households.map((h, i) => (
                <HouseholdCard
                  key={h.id}
                  household={h}
                  index={i}
                  selected={selectedId === h.id}
                  onSelect={handleSelect}
                  members={selectedId === h.id ? members : []}
                  membersLoading={selectedId === h.id && membersLoading}
                  onMemberAdded={handleMemberAdded}
                  onEncounterStarted={handleEncounterStarted}
                />
              ))}
            </section>
          )}
        </div>
      </main>

      {/* ----------------------------------------------------------- */}
      {/* Crisis override (MUST render first so it always wins z-index) */}
      {/* ----------------------------------------------------------- */}
      {crisisRecord?.escalation === true && (
        <CrisisPanel
          record={crisisRecord}
          onConfirm={() => {
            setPostCrisisBanner(
              `Record logged for reporting · ID ${crisisRecord.id} · ` +
                `${new Date(crisisRecord.createdAt).toLocaleString()}`
            );
            setCrisisRecord(null);
          }}
        />
      )}
      {postCrisisBanner && (
        <div className="fixed inset-x-0 bottom-4 z-30 mx-auto w-fit max-w-[92vw] rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-lg dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
          {postCrisisBanner}
        </div>
      )}

      <footer
        className="mt-auto border-t border-border bg-muted/40 px-4 py-4 text-center text-xs text-muted-foreground sm:text-sm"
        role="contentinfo"
      >
        <p className="mx-auto max-w-3xl leading-relaxed">
          Msaada - Identity-chain household register - Demo build - A CHV sees
          only their own assigned households (ownership-scoped) - No
          observation text is stored at the household layer
        </p>
      </footer>

      {/* ----------------------------------------------------------- */}
      {/* New-household sheet (inline modal)                          */}
      {/* ----------------------------------------------------------- */}
      <AnimatePresence>
        {newOpen && (
          <NewHouseholdSheet
            onClose={() => setNewOpen(false)}
            onCreated={(h) => {
              handleCreatedHousehold(h);
              setNewOpen(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------- */}
      {/* Encounter-started confirmation                              */}
      {/* ----------------------------------------------------------- */}
      <AnimatePresence>
        {startedEncounter && (
          <EncounterStartedToast
            encounter={startedEncounter}
            onDismiss={() => setStartedEncounter(null)}
            onRecord={() => {
              setStartedEncounter(null);
              setCaptureEncounter(startedEncounter);
            }}
          />
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------- */}
      {/* Voice-first AI capture sheet (MVP-46)                       */}
      {/* ----------------------------------------------------------- */}
      <AnimatePresence>
        {captureEncounter && (
          <VoiceEncounterCapture
            encounter={captureEncounter}
            household={households.find((h) => h.id === captureEncounter.householdId)}
            onClose={() => setCaptureEncounter(null)}
            onSaved={(record) => {
              setCaptureEncounter(null);
              toast.success("Observation saved", {
                description: `${captureEncounter.encounterCode} · ${record.classification.replace(/_/g, " ")}`,
              });
            }}
            onCrisis={(record) => {
              setCaptureEncounter(null);
              setCrisisRecord(record);
            }}
            onLogout={() => {
              setCaptureEncounter(null);
              setCrisisRecord(null);
              window.location.assign("/");
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ====================================================================== */
/* Header                                                                  */
/* ====================================================================== */

function HouseholdsHeader({
  totalHouseholds,
  totalMembers,
  totalEncounters,
  onRefresh,
  onNew,
}: {
  totalHouseholds: number;
  totalMembers: number;
  totalEncounters: number;
  onRefresh: () => void;
  onNew: () => void;
}) {
  return (
    <header className="mb-6 sm:mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <Home className="mr-1 size-3" aria-hidden />
              Identity chain - Household register
            </Badge>
            <span className="text-xs font-medium text-muted-foreground">
              {totalHouseholds} household
              {totalHouseholds === 1 ? "" : "s"} - {totalMembers} member
              {totalMembers === 1 ? "" : "s"} - {totalEncounters} encounter
              {totalEncounters === 1 ? "" : "s"}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            My households
          </h1>
          <p className="max-w-2xl text-sm text-foreground/70">
            Create a household, add its members, and start a home-visit
            encounter. Each encounter carries the stable code{" "}
            <span className="font-mono text-foreground">MSD-ENC-XXXX</span> which
            links to the observation triage flow on the submission page.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-10 min-h-[44px] px-3"
            onClick={onRefresh}
            aria-label="Refresh households"
          >
            <RefreshCw className="size-4" aria-hidden />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            size="sm"
            onClick={onNew}
            className="h-10 min-h-[44px] bg-emerald-600 px-3 text-white hover:bg-emerald-700"
            aria-label="Create a new household"
          >
            <Plus className="size-4" aria-hidden />
            New household
          </Button>
        </div>
      </div>
      <Separator className="mt-6" />
    </header>
  );
}

/* ====================================================================== */
/* Household card                                                          */
/* ====================================================================== */

function HouseholdCard({
  household,
  index,
  selected,
  onSelect,
  members,
  membersLoading,
  onMemberAdded,
  onEncounterStarted,
}: {
  household: HouseholdDTO;
  index: number;
  selected: boolean;
  onSelect: (h: HouseholdDTO) => void;
  members: HouseholdMemberDTO[];
  membersLoading: boolean;
  onMemberAdded: (m: HouseholdMemberDTO) => void;
  onEncounterStarted: (enc: EncounterDTO) => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        delay: Math.min(index * 0.04, 0.3),
      }}
    >
      <Card
        className={`gap-0 px-4 py-4 sm:px-6 sm:py-5 transition-colors ${
          selected
            ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20"
            : "hover:bg-muted/20"
        }`}
      >
        <CardHeader className="gap-2 px-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                <Home className="size-4" aria-hidden />
              </span>
              <span className="font-mono text-xs font-semibold tracking-wide text-emerald-700 dark:text-emerald-300">
                {household.householdCode}
              </span>
              {household.status !== "active" && (
                <Badge
                  variant="outline"
                  className="border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-semibold uppercase text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  {household.status}
                </Badge>
              )}
            </div>
            <CardTitle className="text-base font-semibold leading-tight text-foreground sm:text-lg">
              {household.label}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" aria-hidden />
                {household.county}
                {household.ward ? ` - ${household.ward}` : ""}
              </span>
              <span aria-hidden>-</span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" aria-hidden />
                {household.memberCount} member
                {household.memberCount === 1 ? "" : "s"}
              </span>
              <span aria-hidden>-</span>
              <span className="inline-flex items-center gap-1">
                <Stethoscope className="size-3" aria-hidden />
                {household.encounterCount} encounter
                {household.encounterCount === 1 ? "" : "s"}
              </span>
            </CardDescription>
          </div>
          <CardAction className="self-center sm:self-start">
            <Button
              variant={selected ? "outline" : "default"}
              size="sm"
              onClick={() => onSelect(household)}
              className="h-10 min-h-[44px] bg-emerald-600 text-white hover:bg-emerald-700"
              aria-expanded={selected}
              aria-controls={`member-panel-${household.id}`}
              aria-label={selected ? "Hide household roster" : "View household roster"}
            >
              {selected ? (
                <>
                  <ChevronUp className="size-4" aria-hidden />
                  <span className="hidden sm:inline">Close</span>
                </>
              ) : (
                <>
                  <span className="hidden sm:inline">View</span>
                  <ChevronDown className="size-4 sm:hidden" aria-hidden />
                </>
              )}
            </Button>
          </CardAction>
        </CardHeader>

        <AnimatePresence initial={false}>
          {selected && (
            <motion.div
              key="member-panel"
              id={`member-panel-${household.id}`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <CardContent className="px-0 pt-4">
                <Separator className="mb-4" />
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    Roster
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {members.length} member{members.length === 1 ? "" : "s"}
                  </span>
                </div>

                {membersLoading ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <Skeleton
                        key={i}
                        className="h-14 w-full rounded-md"
                      />
                    ))}
                  </div>
                ) : members.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
                    <Users
                      className="mx-auto size-6 text-muted-foreground/60"
                      aria-hidden
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      No members yet. Add the first member below to start
                      logging encounters.
                    </p>
                  </div>
                ) : (
                  <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
                    {members.map((m, mi) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        index={mi}
                        householdId={household.id}
                        onEncounterStarted={onEncounterStarted}
                      />
                    ))}
                  </ul>
                )}

                <AddMemberForm
                  householdId={household.id}
                  onAdded={onMemberAdded}
                />
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.article>
  );
}

/* ====================================================================== */
/* Member row                                                              */
/* ====================================================================== */

function MemberRow({
  member,
  index,
  householdId,
  onEncounterStarted,
}: {
  member: HouseholdMemberDTO;
  index: number;
  householdId: string;
  onEncounterStarted: (enc: EncounterDTO) => void;
}) {
  const [starting, setStarting] = useState(false);

  const handleStart = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setStarting(true);
      try {
        const res = await fetch("/api/encounters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // This flow supports voice + typed capture, so record the encounter
          // as "mixed" (schema-allowed; the seed already uses voice/mixed).
          body: JSON.stringify({ householdId, memberId: member.id, captureMethod: "mixed" }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error("Couldn't start encounter", {
            description:
              data?.error === "UNAUTHORIZED"
                ? "You need to be signed in to start an encounter."
                : data?.error === "MEMBER_NOT_IN_HOUSEHOLD"
                  ? "This member is no longer part of this household."
                  : `Server returned ${res.status}.`,
          });
          return;
        }
        toast.success("Encounter started", {
          description: data.encounterCode,
        });
        onEncounterStarted(data as EncounterDTO);
      } catch {
        toast.error("Network error", {
          description: "Could not reach the server. Try again.",
        });
      } finally {
        setStarting(false);
      }
    },
    [householdId, member.id, onEncounterStarted]
  );

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.04, 0.25) }}
      className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
            <Users className="size-3.5" aria-hidden />
          </span>
          <span className="font-mono text-[11px] font-semibold tracking-wide text-teal-700 dark:text-teal-300">
            {member.memberCode}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-xs">
          <span className="font-semibold text-foreground">
            {member.displayName}
          </span>
          {member.role && (
            <>
              <span aria-hidden>-</span>
              <span className="text-muted-foreground">{member.role}</span>
            </>
          )}
          {member.ageBand && (
            <>
              <span aria-hidden>-</span>
              <span className="text-muted-foreground">{member.ageBand}</span>
            </>
          )}
        </div>
      </div>
      <form onSubmit={handleStart} className="shrink-0">
        <Button
          type="submit"
          size="sm"
          disabled={starting}
          aria-label={`Start an encounter for ${member.displayName}`}
          className="h-10 min-h-[44px] bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {starting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Stethoscope className="size-4" aria-hidden />
          )}
          <span>{starting ? "Starting..." : "Start encounter"}</span>
        </Button>
      </form>
    </motion.li>
  );
}

/* ====================================================================== */
/* Add-member form                                                         */
/* ====================================================================== */

function AddMemberForm({
  householdId,
  onAdded,
}: {
  householdId: string;
  onAdded: (m: HouseholdMemberDTO) => void;
}) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<string>("");
  const [ageBand, setAgeBand] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setDisplayName("");
    setRole("");
    setAgeBand("");
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = displayName.trim();
      if (!trimmed) {
        toast.error("Display name is required");
        return;
      }
      setSaving(true);
      try {
        const res = await fetch(`/api/households/${householdId}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: trimmed,
            role: role || undefined,
            ageBand: ageBand || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 409 && data?.error === "DUPLICATE_MEMBER") {
            // Inform only (issue #45) — nothing destructive, no auto-delete.
            toast.info("Member already on this roster", {
              description:
                "This household already has a member with the same name, role and age band. If this is a different person, adjust the display name and try again.",
            });
            return;
          }
          toast.error("Couldn't add member", {
            description:
              data?.error === "UNAUTHORIZED"
                ? "You need to be signed in."
                : data?.error === "NOT_FOUND"
                  ? "This household no longer exists."
                  : `Server returned ${res.status}.`,
          });
          return;
        }
        toast.success("Member added", {
          description: data.memberCode,
        });
        onAdded(data as HouseholdMemberDTO);
        reset();
        setOpen(false);
      } catch {
        toast.error("Network error", {
          description: "Could not reach the server. Try again.",
        });
      } finally {
        setSaving(false);
      }
    },
    [displayName, role, ageBand, householdId, onAdded, reset]
  );

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="mt-4 h-10 min-h-[44px] w-full border-dashed border-emerald-300 bg-emerald-50/40 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
        aria-label="Add a member to this household"
      >
        <UserPlus className="size-4" aria-hidden />
        Add member
      </Button>
    );
  }

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onSubmit={handleSubmit}
      className="mt-4 space-y-3 overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50/30 p-4 dark:border-emerald-900 dark:bg-emerald-950/10"
      aria-label="Add a household member"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">
          Add a household member
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-8 p-0 text-muted-foreground"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          aria-label="Cancel add member"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`m-name-${householdId}`}>
            Display name{" "}
            <span className="text-destructive" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id={`m-name-${householdId}`}
            type="text"
            required
            maxLength={100}
            placeholder="e.g. Mama wa Household 18"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="min-h-11"
            aria-required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`m-role-${householdId}`}>Role</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger
              id={`m-role-${householdId}`}
              className="min-h-11 w-full"
            >
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              {MEMBER_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`m-age-${householdId}`}>Age band</Label>
          <Select value={ageBand} onValueChange={setAgeBand}>
            <SelectTrigger
              id={`m-age-${householdId}`}
              className="min-h-11 w-full"
            >
              <SelectValue placeholder="Select age band" />
            </SelectTrigger>
            <SelectContent>
              {AGE_BANDS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="h-10 min-h-[44px]"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={saving}
          className="h-10 min-h-[44px] bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <UserPlus className="size-4" aria-hidden />
          )}
          {saving ? "Saving..." : "Add member"}
        </Button>
      </div>
    </motion.form>
  );
}

/* ====================================================================== */
/* New-household sheet                                                     */
/* ====================================================================== */

function NewHouseholdSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (h: HouseholdDTO) => void;
}) {
  const [county, setCounty] = useState<County | "">("");
  const [ward, setWard] = useState<string>("");
  const [label, setLabel] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const wardsForCounty = useMemo(
    () => (county ? WARDS[county as County] ?? [] : []),
    [county]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const c = county as County;
      if (!c) {
        toast.error("Select a county");
        return;
      }
      const trimmedLabel = label.trim();
      if (!trimmedLabel) {
        toast.error("A mnemonic label is required", {
          description: "e.g. \u201cHousehold 18, Kariobangi\u201d - not a name.",
        });
        return;
      }
      setSaving(true);
      try {
        const res = await fetch("/api/households", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            county: c,
            ward: ward || undefined,
            label: trimmedLabel,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error("Couldn't create household", {
            description:
              data?.error === "UNAUTHORIZED"
                ? "You need to be signed in to create a household."
                : data?.error === "MISSING_FIELDS"
                  ? "County and label are both required."
                  : data?.error === "COUNTY_MISMATCH"
                    ? "Households are registered in your own county — ask your supervisor if the household really sits elsewhere."
                    : data?.error === "INVALID_COUNTY" || data?.error === "WARD_NOT_IN_COUNTY" || data?.error === "INVALID_WARD"
                      ? "Choose a county and a ward from the listed options."
                      : `Server returned ${res.status}.`,
          });
          return;
        }
        toast.success("Household created", {
          description: data.householdCode,
        });
        onCreated(data as HouseholdDTO);
      } catch {
        toast.error("Network error", {
          description: "Could not reach the server. Try again.",
        });
      } finally {
        setSaving(false);
      }
    },
    [county, ward, label, onCreated]
  );

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    // Lock body scroll while sheet open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-household-title"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="relative m-0 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-background shadow-2xl sm:m-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="gap-0 border-0 px-4 py-0 shadow-none sm:px-6">
          <CardHeader className="gap-2 px-0 pt-4 sm:pt-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <Building2 className="size-4" aria-hidden />
                </span>
                <CardTitle
                  id="new-household-title"
                  className="text-base font-semibold sm:text-lg"
                >
                  New household
                </CardTitle>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="size-9 p-0 text-muted-foreground"
                aria-label="Close new household sheet"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              Create a household register entry. Use a{" "}
              <span className="font-medium text-foreground">mnemonic label</span>
              {" "}— e.g.{" "}
              <span className="font-mono text-foreground">
                Household 18, Kariobangi
              </span>{" "}
              — not a personal name.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-0 pb-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="hh-county">
                    County{" "}
                    <span className="text-destructive" aria-hidden>
                      *
                    </span>
                  </Label>
                  <Select
                    value={county}
                    onValueChange={(v) => {
                      setCounty(v as County);
                      setWard("");
                    }}
                  >
                    <SelectTrigger
                      id="hh-county"
                      className="min-h-11 w-full"
                      aria-required
                    >
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
                  <Label htmlFor="hh-ward">Ward</Label>
                  <Select
                    value={ward}
                    onValueChange={setWard}
                    disabled={!county}
                  >
                    <SelectTrigger
                      id="hh-ward"
                      className="min-h-11 w-full"
                    >
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

              <div className="space-y-1.5">
                <Label htmlFor="hh-label">
                  Mnemonic label{" "}
                  <span className="text-destructive" aria-hidden>
                    *
                  </span>
                </Label>
                <Input
                  id="hh-label"
                  type="text"
                  required
                  maxLength={100}
                  placeholder="Household 18, Kariobangi"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="min-h-11"
                  aria-required
                />
                <p className="text-[11px] text-muted-foreground">
                  A short, recognizable tag for the household. Not a person&apos;s
                  name. Capped at 100 characters.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="h-10 min-h-[44px]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={saving}
                  className="h-10 min-h-[44px] bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="size-4" aria-hidden />
                  )}
                  {saving ? "Creating..." : "Create household"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

/* ====================================================================== */
/* Encounter-started banner                                                */
/* ====================================================================== */

function EncounterStartedToast({
  encounter,
  onDismiss,
  onRecord,
}: {
  encounter: EncounterDTO;
  onDismiss: () => void;
  /** Opens the voice-first capture sheet for this encounter (MVP-46). */
  onRecord: () => void;
}) {
  // Auto-dismiss after 12s (but the user can also click through / dismiss).
  useEffect(() => {
    const id = setTimeout(onDismiss, 12000);
    return () => clearTimeout(id);
  }, [onDismiss]);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDismiss]);

  const observeHref = `/?encounter=${encodeURIComponent(encounter.id)}`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enc-started-title"
      onClick={onDismiss}
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="relative m-0 w-full max-w-md overflow-y-auto rounded-t-2xl border border-emerald-200 bg-background shadow-2xl sm:m-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="gap-0 border-0 px-4 py-4 shadow-none sm:px-6">
          <CardHeader className="gap-2 px-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <Stethoscope className="size-4" aria-hidden />
                </span>
                <CardTitle
                  id="enc-started-title"
                  className="text-base font-semibold sm:text-lg"
                >
                  Encounter started
                </CardTitle>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDismiss}
                className="size-9 p-0 text-muted-foreground"
                aria-label="Dismiss"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              Capture your home-visit observation under this encounter code. The
              triage result will be linked back to this household member.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                Encounter code
              </p>
              <p className="mt-0.5 font-mono text-lg font-bold tracking-wide text-foreground">
                {encounter.encounterCode}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Household</dt>
                <dd className="truncate font-medium text-foreground">
                  {encounter.householdLabel}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Member</dt>
                <dd className="truncate font-medium text-foreground">
                  {encounter.memberDisplayName}
                </dd>
              </div>
            </dl>
            <Button
              type="button"
              size="sm"
              onClick={onRecord}
              className="h-11 min-h-[44px] w-full bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Mic className="size-4" aria-hidden />
              Record observation
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-11 min-h-[44px] w-full"
            >
              <Link
                href={observeHref}
                aria-label="Type observation on the submission page"
              >
                Start observation (type instead)
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

/* ====================================================================== */
/* Loading / empty / error / unauthed states                              */
/* ====================================================================== */

function HouseholdsSkeleton() {
  return (
    <section
      aria-label="Loading households"
      aria-busy="true"
      className="space-y-3"
    >
      {[0, 1, 2].map((i) => (
        <Card key={i} className="gap-0 px-4 py-4 sm:px-6 sm:py-5">
          <CardHeader className="gap-2 px-0">
            <div className="flex items-center gap-2">
              <Skeleton className="size-7 rounded-md" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-72" />
          </CardHeader>
        </Card>
      ))}
    </section>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      aria-label="No households"
    >
      <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-12 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
          <Building2 className="size-6" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="text-lg font-semibold">No households yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Create your first household to start registering members and
            logging home-visit encounters. Each household gets a stable code
            (MSD-HH-XXXX) you can quote back to the family.
          </p>
        </div>
        <Button
          size="lg"
          onClick={onNew}
          className="mt-2 h-11 min-w-[180px] bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <Plus className="size-4" aria-hidden />
          Create a household
        </Button>
      </Card>
    </motion.section>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 border-red-200 bg-red-50 px-6 py-10 text-center dark:border-red-900 dark:bg-red-950/30">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-lg font-semibold">Couldn&apos;t load households</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      <Button
        variant="outline"
        size="lg"
        onClick={onRetry}
        className="mt-2 h-11 min-w-[180px]"
      >
        <RefreshCw className="size-4" aria-hidden />
        Try again
      </Button>
    </Card>
  );
}

function UnauthedState() {
  return (
    <Card className="flex flex-col items-center gap-3 border-amber-200 bg-amber-50 px-6 py-10 text-center dark:border-amber-900 dark:bg-amber-950/30">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
        <Home className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-lg font-semibold">Sign in to view your households</p>
        <p className="max-w-md text-sm text-muted-foreground">
          The household register is ownership-scoped - you need to be signed in
          as a CHV to see your assigned households.
        </p>
      </div>
      <Button
        asChild
        size="lg"
        className="mt-2 h-11 min-w-[180px] bg-emerald-600 text-white hover:bg-emerald-700"
      >
        <Link href="/" aria-label="Go to CHV sign in">
          Go to sign in
        </Link>
      </Button>
    </Card>
  );
}
