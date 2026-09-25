"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  RefreshCw,
  ClipboardList,
  CheckCircle2,
  XCircle,
  MapPin,
  Clock,
  Activity,
  Inbox,
  AlertCircle,
  Filter,
  Stethoscope,
  HeartPulse,
  Baby,
  Users,
  CircleHelp,
  PlayCircle,
  ClipboardCheck,
  ShieldCheck,
  PhoneMissed,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AppNav } from "@/components/msaada/AppNav";

/**
 * /cases — CHV Response Workflow dashboard (CR-009).
 *
 * A CHV-facing list of community reports that have been routed to them by
 * the policy engine + supervisor assignment. Each row is a response case
 * (MSD-CASE-XXXX) tied to a de-identified community report (MSD-RPT-XXXX).
 *
 * The CHV can advance the case through its lifecycle:
 *   assigned → accepted → response_started → attended → resolved
 *                                              ↘ unable_to_reach
 *
 * All mutations go through the REST API (no server actions):
 *   GET   /api/response-cases           — list (auth-scoped to the CHV)
 *   PATCH /api/response-cases/[id]?action=accept|start|attend|resolve|unable_to_reach
 *
 * The "resolve" action opens an inline resolution-note textarea (the note
 * is PII-scrubbed server-side before persistence — same invariant as
 * `followups/[id]` PATCH).
 *
 * De-identification: the report description shown here is ALREADY scrubbed
 * at the data-access boundary (community-report-store.toReportDTO), so the
 * UI never touches raw concern text.
 */

// ---- DTO (mirrors ResponseCaseDTO from src/lib/community-report-types.ts) ----

interface ResponseCaseDTO {
  id: string;
  caseCode: string;
  createdAt: string;
  updatedAt: string;
  reportId: string;
  reportCode: string;
  assignedChvId: string | null;
  assignedSupervisorId: string | null;
  assignmentReason: string | null;
  assignedAt: string | null;
  acceptedAt: string | null;
  status: string;
  encounterId: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  // Denormalized from the report
  reportDescription: string;
  reportCategory: string;
  county: string;
  ward: string | null;
  landmark: string | null;
  directions: string | null;
  aiIntake: {
    summary: string;
    urgency: "low" | "medium" | "high";
    suggestedCategory: string;
    questionsForVisit: string[];
    missingInformation: string[];
  } | null;
}

type StatusFilter =
  | "all"
  | "assigned"
  | "accepted"
  | "response_started"
  | "attended"
  | "resolved"
  | "unable_to_reach";

type LoadState = "loading" | "ready" | "error" | "unauthed";
type CaseAction =
  | "accept"
  | "start"
  | "attend"
  | "resolve"
  | "unable_to_reach";

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All cases" },
  { value: "assigned", label: "Assigned (awaiting accept)" },
  { value: "accepted", label: "Accepted (ready to start)" },
  { value: "response_started", label: "Response started" },
  { value: "attended", label: "Attended" },
  { value: "resolved", label: "Resolved" },
  { value: "unable_to_reach", label: "Unable to reach" },
];

// Tone maps — emerald/teal palette only (NO indigo/blue per house style).
// Each status has a soft bg + foreground text + dot color for the badge.

const STATUS_TONE: Record<
  string,
  { soft: string; text: string; dot: string; label: string }
> = {
  assigned: {
    soft: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    label: "Assigned",
  },
  accepted: {
    soft: "bg-teal-50 dark:bg-teal-950/40",
    text: "text-teal-700 dark:text-teal-300",
    dot: "bg-teal-500",
    label: "Accepted",
  },
  response_started: {
    soft: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    label: "Response started",
  },
  attended: {
    soft: "bg-emerald-100 dark:bg-emerald-950/60",
    text: "text-emerald-800 dark:text-emerald-200",
    dot: "bg-emerald-600",
    label: "Attended",
  },
  resolved: {
    soft: "bg-emerald-100 dark:bg-emerald-950/60",
    text: "text-emerald-800 dark:text-emerald-200",
    dot: "bg-emerald-600",
    label: "Resolved",
  },
  unable_to_reach: {
    soft: "bg-red-50 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-300",
    dot: "bg-red-500",
    label: "Unable to reach",
  },
};

const CATEGORY_META: Record<
  string,
  { label: string; icon: typeof HeartPulse; tone: string }
> = {
  mental_health: {
    label: "Mental health",
    icon: HeartPulse,
    tone: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900",
  },
  maternal: {
    label: "Maternal",
    icon: Stethoscope,
    tone: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  },
  child_health: {
    label: "Child health",
    icon: Baby,
    tone: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  },
  social_support: {
    label: "Social support",
    icon: Users,
    tone: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  },
  other: {
    label: "Other",
    icon: CircleHelp,
    tone: "bg-muted text-muted-foreground border-border",
  },
};

// Statuses where the CHV still owes an action.
const PENDING_ACTION_STATUSES = new Set([
  "assigned",
  "accepted",
  "response_started",
]);

// ---- Helpers ----

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - then;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

function categoryMeta(cat: string) {
  return (
    CATEGORY_META[cat] ?? {
      label: cat.replace(/_/g, " "),
      icon: CircleHelp,
      tone: CATEGORY_META.other.tone,
    }
  );
}

function statusTone(status: string) {
  return (
    STATUS_TONE[status] ?? {
      soft: "bg-muted",
      text: "text-muted-foreground",
      dot: "bg-muted-foreground/50",
      label: status.replace(/_/g, " "),
    }
  );
}

// ---- Page ----

export default function CasesPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [cases, setCases] = useState<ResponseCaseDTO[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [actioningId, setActioningId] = useState<string | null>(null);
  // Per-case inline "resolve" expansion — only one open at a time.
  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setState((s) => (s === "ready" ? s : "loading"));
    try {
      const res = await fetch("/api/response-cases", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.status === 401) {
        setCases([]);
        setState("unauthed");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { cases?: ResponseCaseDTO[] };
      setCases(data.cases ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Filtered view (client-side; the list is already auth-scoped to ~50 rows).
  const filtered = useMemo(() => {
    if (filter === "all") return cases;
    return cases.filter((c) => c.status === filter);
  }, [cases, filter]);

  // KPIs — computed off the full (unfiltered) list.
  const kpis = useMemo(() => {
    const totalAssigned = cases.length;
    const pendingAction = cases.filter((c) =>
      PENDING_ACTION_STATUSES.has(c.status)
    ).length;
    const attended = cases.filter((c) => c.status === "attended").length;
    const resolved = cases.filter((c) => c.status === "resolved").length;
    return { totalAssigned, pendingAction, attended, resolved };
  }, [cases]);

  async function handleAction(
    c: ResponseCaseDTO,
    action: CaseAction,
    note?: string
  ) {
    setActioningId(c.id);
    try {
      const body =
        action === "resolve"
          ? JSON.stringify({ resolutionNote: note?.trim() || undefined })
          : "{}";
      const res = await fetch(
        `/api/response-cases/${c.id}?action=${action}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body,
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const field = d.field ? ` (${d.field})` : "";
        toast.error(`Couldn't ${actionLabel(action)} this case${field}`, {
          description: d.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const updated = (await res.json()) as ResponseCaseDTO | null;
      toast.success(`${actionLabel(action)} — case updated`, {
        description:
          action === "resolve"
            ? "Resolution note saved (de-identified)."
            : `${c.caseCode} advanced to "${(updated?.status ?? action).replace(/_/g, " ")}".`,
      });
      // Collapse the resolve form on success.
      if (action === "resolve") {
        setResolveOpenId(null);
        setResolveNote("");
      }
      await load();
    } catch {
      toast.error("Network error — couldn't reach the server.");
    } finally {
      setActioningId(null);
    }
  }

  function actionLabel(action: CaseAction): string {
    switch (action) {
      case "accept":
        return "accept";
      case "start":
        return "start response on";
      case "attend":
        return "mark attended";
      case "resolve":
        return "resolve";
      case "unable_to_reach":
        return "mark unable to reach";
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background lg:pl-64 print:pl-0">
      <AppNav />
      <main id="main" className="flex-1" tabIndex={-1}>
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {/* Header */}
          <header className="mb-5 sm:mb-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <Badge
                  variant="outline"
                  className="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300"
                >
                  <ClipboardCheck className="mr-1 size-3" aria-hidden />
                  CHV workflow
                </Badge>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  My Response Cases
                </h1>
                <p className="max-w-2xl text-sm text-foreground/70">
                  Community reports assigned to you. Track from assignment to
                  outcome.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  onClick={() => void load()}
                  size="sm"
                  variant="outline"
                  className="h-11 min-h-[44px] px-3"
                  aria-label="Refresh case list"
                  disabled={state === "loading"}
                >
                  <RefreshCw
                    className={cn(
                      "size-4",
                      state === "loading" && "animate-spin"
                    )}
                    aria-hidden
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
              </div>
            </div>
            <Separator className="mt-5" />
          </header>

          {/* KPI row */}
          <section
            aria-label="Case summary"
            className="mb-5 grid grid-cols-2 gap-3 sm:mb-6 sm:grid-cols-4"
          >
            <KpiCard
              label="Total assigned"
              value={kpis.totalAssigned}
              icon={ClipboardList}
              tone="teal"
            />
            <KpiCard
              label="Pending action"
              value={kpis.pendingAction}
              icon={Activity}
              tone="amber"
            />
            <KpiCard
              label="Attended"
              value={kpis.attended}
              icon={ShieldCheck}
              tone="emerald"
            />
            <KpiCard
              label="Resolved"
              value={kpis.resolved}
              icon={CheckCircle2}
              tone="emerald"
            />
          </section>

          {/* Filter bar */}
          <section
            aria-label="Filter cases"
            className="mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-2">
              <Filter
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <Label
                htmlFor="status-filter"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Status
              </Label>
              <Select
                value={filter}
                onValueChange={(v) => setFilter(v as StatusFilter)}
              >
                <SelectTrigger
                  id="status-filter"
                  className="h-11 min-h-[44px] w-full sm:w-72"
                  aria-label="Filter cases by status"
                >
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  {FILTER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground sm:text-right">
              {filtered.length}{" "}
              {filtered.length === 1 ? "case" : "cases"}
              {filter !== "all" ? ` · ${statusTone(filter).label.toLowerCase()}` : ""}
            </p>
          </section>

          {/* Body */}
          {state === "loading" ? (
            <CaseListSkeleton />
          ) : state === "unauthed" ? (
            <Card className="px-6 py-12 text-center">
              <ClipboardCheck
                className="mx-auto size-8 text-muted-foreground/50"
                aria-hidden
              />
              <p className="mt-3 text-sm text-muted-foreground">
                Sign in to view cases assigned to you.
              </p>
              <Button asChild size="sm" className="mt-4 h-11 min-h-[44px]">
                <Link href="/">Sign in</Link>
              </Button>
            </Card>
          ) : state === "error" ? (
            <Card className="px-6 py-12 text-center">
              <AlertCircle
                className="mx-auto size-8 text-red-500/70"
                aria-hidden
              />
              <p className="mt-3 text-sm text-muted-foreground">
                Couldn&apos;t load your cases.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 h-11 min-h-[44px]"
                onClick={() => void load()}
              >
                <RefreshCw className="size-4" aria-hidden />
                Retry
              </Button>
            </Card>
          ) : filtered.length === 0 ? (
            <Card className="px-6 py-12 text-center">
              <Inbox
                className="mx-auto size-8 text-muted-foreground/50"
                aria-hidden
              />
              <p className="mt-3 text-sm font-medium text-foreground">
                {cases.length === 0
                  ? "No cases assigned to you yet."
                  : `No ${statusTone(filter).label.toLowerCase()} cases.`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {cases.length === 0
                  ? "When a supervisor routes a community report to you, it will appear here."
                  : "Try a different status filter."}
              </p>
            </Card>
          ) : (
            <motion.ul
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
              aria-label="Response cases"
            >
              <AnimatePresence initial={false}>
                {filtered.map((c, idx) => (
                  <motion.li
                    key={c.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, delay: idx * 0.02 }}
                  >
                    <CaseCard
                      c={c}
                      actioningId={actioningId}
                      resolveOpenId={resolveOpenId}
                      resolveNote={resolveNote}
                      onToggleResolve={() => {
                        setResolveOpenId(
                          resolveOpenId === c.id ? null : c.id
                        );
                        if (resolveOpenId !== c.id) setResolveNote("");
                      }}
                      onResolveNoteChange={setResolveNote}
                      onAction={(action, note) =>
                        void handleAction(c, action, note)
                      }
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          )}

          <p className="mt-6 px-1 text-center text-[11px] text-muted-foreground">
            Msaada · De-identified community reports · Ownership-scoped (your
            assignments only) · Crisis line: Kenya Red Cross 1199 / Befrienders
            Kenya +254 722 178 177
          </p>
        </div>
      </main>

      <footer
        className="mt-auto border-t bg-background/80 backdrop-blur"
        role="contentinfo"
      >
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            Msaada response workflow · CHV assignment → outcome · Not a
            diagnostic tool
          </p>
        </div>
      </footer>
    </div>
  );
}

// ---- Sub-components ----

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof ClipboardList;
  tone: "teal" | "emerald" | "amber";
}) {
  // Tone colours only the icon chip; the card itself stays neutral.
  const toneCls = {
    teal: "bg-muted text-muted-foreground",
    emerald:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    amber:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  }[tone];
  return (
    <Card className="gap-0 py-0">
      <CardContent className="px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-muted-foreground">
            {label}
          </span>
          <span
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md",
              toneCls
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

const URGENCY_STYLES: Record<"low" | "medium" | "high", string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  high: "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300",
};

/** Advisory AI intake for the report: summary, urgency, what to ask. */
function AiIntakePanel({ intake }: { intake: NonNullable<ResponseCaseDTO["aiIntake"]> }) {
  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-primary" aria-hidden />
        <span className="text-xs font-semibold text-foreground">AI intake</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] font-medium capitalize",
            URGENCY_STYLES[intake.urgency]
          )}
        >
          {intake.urgency} urgency
        </span>
        <span className="text-[11px] text-muted-foreground">
          Suggestion only · verify on your visit
        </span>
      </div>
      <p className="mt-2 text-sm text-foreground">{intake.summary}</p>
      {intake.questionsForVisit.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-muted-foreground">Questions to ask</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">
            {intake.questionsForVisit.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {intake.missingInformation.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-muted-foreground">Not in the report</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">
            {intake.missingInformation.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CaseCard({
  c,
  actioningId,
  resolveOpenId,
  resolveNote,
  onToggleResolve,
  onResolveNoteChange,
  onAction,
}: {
  c: ResponseCaseDTO;
  actioningId: string | null;
  resolveOpenId: string | null;
  resolveNote: string;
  onToggleResolve: () => void;
  onResolveNoteChange: (v: string) => void;
  onAction: (action: CaseAction, note?: string) => void;
}) {
  const status = statusTone(c.status);
  const cat = categoryMeta(c.reportCategory);
  const CatIcon = cat.icon;
  const busy = actioningId === c.id;
  const isResolveOpen = resolveOpenId === c.id;
  const isActive = PENDING_ACTION_STATUSES.has(c.status) || c.status === "attended";

  return (
    <Card
      className={cn(
        "overflow-hidden border-border/60 transition-colors",
        busy && "opacity-70"
      )}
    >
      <CardContent className="px-4 py-4 sm:px-5 sm:py-5">
        {/* Top row: case code + status badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold text-foreground">
              {c.caseCode}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {c.reportCode}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "h-6 shrink-0 gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide",
              status.soft,
              status.text
            )}
          >
            <span className={cn("size-1.5 rounded-full", status.dot)} aria-hidden />
            {status.label}
          </Badge>
        </div>

        <Separator className="my-3" />

        {/* Category + location + assignment time */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge
            variant="outline"
            className={cn("h-6 gap-1 px-2 text-[11px] font-medium", cat.tone)}
          >
            <CatIcon className="size-3" aria-hidden />
            {cat.label}
          </Badge>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MapPin className="size-3" aria-hidden />
            <span className="truncate">
              {c.county}
              {c.ward ? ` · ${c.ward}` : ""}
              {c.landmark ? ` · ${c.landmark}` : ""}
            </span>
          </span>
        </div>

        {/* Description (de-identified) */}
        <p className="mt-3 text-sm text-foreground/90">
          {c.reportDescription}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          De-identified — names/contacts scrubbed before storage.
        </p>

        {c.aiIntake && <AiIntakePanel intake={c.aiIntake} />}

        {/* Assignment reason + time */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden />
            Assigned {relativeTime(c.assignedAt)}
          </span>
          {c.assignmentReason && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{c.assignmentReason}</span>
            </>
          )}
          {c.acceptedAt && (
            <>
              <span aria-hidden>·</span>
              <span>Accepted {relativeTime(c.acceptedAt)}</span>
            </>
          )}
          {c.resolvedAt && (
            <>
              <span aria-hidden>·</span>
              <span>Resolved {relativeTime(c.resolvedAt)}</span>
            </>
          )}
        </div>

        {/* Show resolution note (for resolved / unable_to_reach) */}
        {c.resolutionNote &&
          (c.status === "resolved" || c.status === "unable_to_reach") && (
            <div className="mt-3 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Outcome note
              </p>
              <p className="mt-0.5 text-xs text-foreground/90">
                {c.resolutionNote}
              </p>
            </div>
          )}

        {/* Action buttons */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {c.status === "assigned" && (
            <ActionButton
              icon={CheckCircle2}
              label="Accept"
              tone="primary"
              busy={busy}
              onClick={() => onAction("accept")}
            />
          )}
          {c.status === "accepted" && (
            <ActionButton
              icon={PlayCircle}
              label="Start response"
              tone="primary"
              busy={busy}
              onClick={() => onAction("start")}
            />
          )}
          {c.status === "response_started" && (
            <ActionButton
              icon={ClipboardCheck}
              label="Mark attended"
              tone="primary"
              busy={busy}
              onClick={() => onAction("attend")}
            />
          )}
          {c.status === "attended" && (
            <ActionButton
              icon={ShieldCheck}
              label="Resolve"
              tone="primary"
              busy={busy}
              onClick={onToggleResolve}
              ariaExpanded={isResolveOpen}
            />
          )}

          {/* "Unable to reach" — shown on any active status */}
          {isActive && (
            <ActionButton
              icon={PhoneMissed}
              label="Unable to reach"
              tone="danger-outline"
              busy={busy}
              onClick={() => onAction("unable_to_reach")}
            />
          )}

          {/* For terminal cases with no action buttons, show a small status pill */}
          {!isActive && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              {c.status === "resolved" ? (
                <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
              ) : (
                <XCircle className="size-3.5 text-red-500" aria-hidden />
              )}
              No further action
            </span>
          )}
        </div>

        {/* Inline resolve form */}
        <AnimatePresence initial={false}>
          {isResolveOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
                <Label
                  htmlFor={`resolve-note-${c.id}`}
                  className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Outcome note (de-identified — no names/addresses)
                </Label>
                <Textarea
                  id={`resolve-note-${c.id}`}
                  value={resolveNote}
                  onChange={(e) => onResolveNoteChange(e.target.value)}
                  placeholder="e.g. Counselling session completed, household referred to clinic for follow-up."
                  className="min-h-[80px] text-sm"
                  maxLength={500}
                  disabled={busy}
                />
                <p className="text-[11px] text-muted-foreground">
                  {resolveNote.length}/500 · Will be PII-scrubbed before storage.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-11 min-h-[44px] bg-emerald-600 hover:bg-emerald-700"
                    disabled={busy}
                    onClick={() => onAction("resolve", resolveNote)}
                  >
                    <CheckCircle2 className="size-4" aria-hidden />
                    Confirm resolve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-11 min-h-[44px]"
                    onClick={onToggleResolve}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function ActionButton({
  icon: Icon,
  label,
  tone,
  busy,
  onClick,
  ariaExpanded,
}: {
  icon: typeof CheckCircle2;
  label: string;
  tone: "primary" | "danger-outline";
  busy: boolean;
  onClick: () => void;
  ariaExpanded?: boolean;
}) {
  const cls =
    tone === "primary"
      ? "bg-emerald-600 text-white hover:bg-emerald-700"
      : "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40";
  return (
    <Button
      type="button"
      size="sm"
      variant={tone === "primary" ? "default" : "outline"}
      className={cn("h-11 min-h-[44px] px-3", tone === "primary" && cls)}
      onClick={onClick}
      disabled={busy}
      aria-expanded={ariaExpanded}
    >
      {busy ? (
        <RefreshCw className="size-4 animate-spin" aria-hidden />
      ) : (
        <Icon className="size-4" aria-hidden />
      )}
      {label}
    </Button>
  );
}

function CaseListSkeleton() {
  return (
    <ul className="space-y-3" aria-label="Loading cases" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <li key={i}>
          <Card className="overflow-hidden border-border/60">
            <CardContent className="px-4 py-4 sm:px-5 sm:py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40 rounded" />
                  <Skeleton className="h-3 w-28 rounded" />
                </div>
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-px w-full" />
              <div className="mt-3 flex gap-2">
                <Skeleton className="h-6 w-28 rounded-full" />
                <Skeleton className="h-6 w-40 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-4 w-full rounded" />
              <Skeleton className="mt-2 h-4 w-3/4 rounded" />
              <Skeleton className="mt-2 h-3 w-1/2 rounded" />
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-11 w-28 rounded-md" />
                <Skeleton className="h-11 w-32 rounded-md" />
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
