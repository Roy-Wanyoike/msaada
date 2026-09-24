"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  MapPin,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ShieldCheck,
  Activity,
  Stethoscope,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TONE } from "@/components/msaada/dashboard-helpers";
import type { Classification, TriageRecordDTO } from "@/lib/types";

interface Props {
  /** Bumped by the parent whenever a new triage result lands, to trigger a refetch. */
  refreshKey: number;
}

type LoadState = "loading" | "ready" | "error";

const CLASS_LABEL: Record<Classification, string> = {
  routine: "Routine",
  needs_followup: "Needs follow-up",
  needs_facility_referral: "Facility referral",
};

function classIcon(c: Classification, escalation: boolean) {
  if (escalation) return AlertTriangle;
  if (c === "routine") return ShieldCheck;
  if (c === "needs_followup") return Activity;
  return Stethoscope;
}

function toneKey(c: Classification, escalation: boolean) {
  if (escalation) return "escalation" as const;
  return c;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * "My recent observations" — a CHV-facing panel showing their own de-identified
 * triage history (ownership-scoped via /api/records/mine). Other CHVs' records
 * are never exposed. Collapsible to keep the submission form the primary focus.
 */
export function MyRecentObservations({ refreshKey }: Props) {
  const [state, setState] = useState<LoadState>("loading");
  const [records, setRecords] = useState<TriageRecordDTO[]>([]);
  const [open, setOpen] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((s) => (s === "ready" ? s : "loading"));
    try {
      const res = await fetch("/api/records/mine?limit=15", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.status === 401) {
        setRecords([]);
        setState("ready");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { records: TriageRecordDTO[] };
      setRecords(data.records);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const total = records.length;
  const escalations = records.filter((r) => r.escalation).length;

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300">
            <Clock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold leading-tight">
              My recent observations
            </CardTitle>
            <p className="truncate text-xs text-muted-foreground">
              {state === "loading"
                ? "Loading…"
                : state === "ready"
                  ? `${total} record${total === 1 ? "" : "s"}${
                      escalations > 0
                        ? ` · ${escalations} escalation${escalations === 1 ? "" : "s"}`
                        : ""
                    }`
                  : "Couldn't load"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground"
            onClick={() => void load()}
            aria-label="Refresh my observations"
          >
            <RefreshCw className="size-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
          >
            {open ? (
              <ChevronUp className="size-4" aria-hidden />
            ) : (
              <ChevronDown className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </CardHeader>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <CardContent className="px-4 pb-4 sm:px-6">
              {state === "loading" ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-md" />
                  ))}
                </div>
              ) : state === "error" ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Couldn&apos;t load your recent observations.{" "}
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Retry
                  </button>
                </p>
              ) : total === 0 ? (
                <div className="py-6 text-center">
                  <Clock className="mx-auto size-6 text-muted-foreground/60" aria-hidden />
                  <p className="mt-2 text-xs text-muted-foreground">
                    No observations yet. Submit one above to see it here.
                  </p>
                </div>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {records.map((r) => {
                    const tone = TONE[toneKey(r.classification, r.escalation)];
                    const Icon = classIcon(r.classification, r.escalation);
                    const isExpanded = expandedId === r.id;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          className={`w-full rounded-lg border ${tone.border} ${tone.soft} px-3 py-2.5 text-left transition-colors hover:bg-opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                          aria-expanded={isExpanded}
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md ${tone.text}`}
                            >
                              <Icon className="size-3.5" aria-hidden />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={`shrink-0 border-current/20 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide ${tone.text}`}
                                >
                                  {r.escalation ? "Crisis" : CLASS_LABEL[r.classification]}
                                </Badge>
                                {r.aggregateTag && (
                                  <span className="truncate text-[11px] text-muted-foreground">
                                    {r.aggregateTag.replace(/_/g, " ")}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span className="inline-flex items-center gap-0.5">
                                  <MapPin className="size-3" aria-hidden />
                                  {r.county}
                                  {r.ward ? ` · ${r.ward}` : ""}
                                </span>
                                <span aria-hidden>·</span>
                                <span>{relativeTime(r.createdAt)}</span>
                              </div>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            ) : (
                              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            )}
                          </div>
                          <AnimatePresence initial={false}>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                className="overflow-hidden"
                              >
                                <div className="mt-2.5 space-y-2 border-t border-border/40 pt-2.5 text-xs">
                                  {r.escalation && r.chpInstruction && (
                                    <p className="rounded-md bg-red-50 px-2 py-1.5 text-red-800 dark:bg-red-950/40 dark:text-red-200">
                                      <span className="font-semibold">Crisis instruction: </span>
                                      {r.chpInstruction}
                                    </p>
                                  )}
                                  {!r.escalation && r.chpNextAction && (
                                    <p>
                                      <span className="font-semibold text-foreground">CHP next action: </span>
                                      <span className="text-muted-foreground">{r.chpNextAction}</span>
                                    </p>
                                  )}
                                  {!r.escalation && r.observedIndicators.length > 0 && (
                                    <div>
                                      <span className="font-semibold text-foreground">Indicators: </span>
                                      <span className="text-muted-foreground">
                                        {r.observedIndicators.join(" · ")}
                                      </span>
                                    </div>
                                  )}
                                  {r.confidenceNote && (
                                    <p className="italic text-muted-foreground/80">
                                      Note: {r.confidenceNote}
                                    </p>
                                  )}
                                  <p className="text-[10px] text-muted-foreground/70">
                                    Record {r.id.slice(-12)} · de-identified
                                  </p>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
