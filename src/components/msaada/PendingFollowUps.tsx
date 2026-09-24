"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ClipboardCheck,
  RefreshCw,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertCircle,
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FollowUpDTO {
  id: string;
  createdAt: string;
  dueAt: string;
  status: "pending" | "done" | "missed";
  resolvedAt: string | null;
  resolutionNote: string | null;
  triageRecordId: string;
  chvId: string;
  county: string;
  ward: string | null;
  classification: string;
  escalation: boolean;
  aggregateTag: string | null;
  chpNextAction: string | null;
}

interface Props {
  refreshKey: number;
}

type LoadState = "loading" | "ready" | "error";

const CLASS_LABEL: Record<string, string> = {
  routine: "Routine",
  needs_followup: "Needs follow-up",
  needs_facility_referral: "Facility referral",
};

function relativeDue(iso: string): { label: string; overdue: boolean; soon: boolean } {
  const due = new Date(iso).getTime();
  const now = Date.now();
  const diff = due - now;
  const hr = Math.floor(Math.abs(diff) / 3600000);
  const min = Math.floor((Math.abs(diff) % 3600000) / 60000);
  const overdue = diff < 0;
  const soon = !overdue && diff < 6 * 3600000; // <6h
  const label = overdue
    ? `${hr}h ${min}m overdue`
    : hr < 1
      ? `${min}m left`
      : `${hr}h ${min}m left`;
  return { label, overdue, soon };
}

/**
 * "Pending follow-ups" — a CHV-facing panel showing follow-ups due from
 * needs_followup / needs_facility_referral triages. The CHV can mark each
 * done or missed, with an optional de-identified resolution note. Live-
 * refreshes after every new triage via refreshKey.
 */
export function PendingFollowUps({ refreshKey }: Props) {
  const [state, setState] = useState<LoadState>("loading");
  const [followUps, setFollowUps] = useState<FollowUpDTO[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setState((s) => (s === "ready" ? s : "loading"));
    try {
      const res = await fetch("/api/followups?status=pending&limit=20", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.status === 401) {
        setFollowUps([]);
        setState("ready");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFollowUps(data.followUps ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function handleResolve(id: string, status: "done" | "missed") {
    setResolvingId(id);
    try {
      const res = await fetch(`/api/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ status, resolutionNote: note || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error("Couldn't resolve follow-up", {
          description: d.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      toast.success(status === "done" ? "Marked as done" : "Marked as missed", {
        description: "Follow-up resolved.",
      });
      setExpandedId(null);
      setNote("");
      await load();
    } catch {
      toast.error("Network error — couldn't reach the server.");
    } finally {
      setResolvingId(null);
    }
  }

  const count = followUps.length;
  const overdueCount = followUps.filter((f) => relativeDue(f.dueAt).overdue).length;

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
              overdueCount > 0
                ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300"
                : "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
            )}
          >
            <ClipboardCheck className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold leading-tight">
              Pending follow-ups
            </CardTitle>
            <p className="truncate text-xs text-muted-foreground">
              {state === "loading"
                ? "Loading…"
                : state === "ready"
                  ? count === 0
                    ? "All caught up"
                    : `${count} pending${overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}`
                  : "Couldn't load"}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground"
          onClick={() => void load()}
          aria-label="Refresh follow-ups"
        >
          <RefreshCw className="size-3.5" aria-hidden />
        </Button>
      </CardHeader>

      <CardContent className="px-4 pb-4 sm:px-6">
        {state === "loading" ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
            ))}
          </div>
        ) : state === "error" ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Couldn&apos;t load your follow-ups.{" "}
            <button
              type="button"
              onClick={() => void load()}
              className="font-medium text-foreground underline underline-offset-2"
            >
              Retry
            </button>
          </p>
        ) : count === 0 ? (
          <div className="py-6 text-center">
            <Check className="mx-auto size-6 text-emerald-500/70" aria-hidden />
            <p className="mt-2 text-xs text-muted-foreground">
              No pending follow-ups. You&apos;re all caught up.
            </p>
          </div>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {followUps.map((f) => {
                const due = relativeDue(f.dueAt);
                const isExpanded = expandedId === f.id;
                return (
                  <motion.li
                    key={f.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <div
                      className={cn(
                        "rounded-lg border px-3 py-2.5",
                        due.overdue
                          ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
                          : due.soon
                            ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20"
                            : "border-border/50 bg-muted/20"
                      )}
                    >
                      {/* Header row */}
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : f.id)}
                        className="flex w-full items-center gap-2.5 text-left"
                        aria-expanded={isExpanded}
                      >
                        <span
                          className={cn(
                            "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                            f.classification === "needs_facility_referral"
                              ? "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          )}
                        >
                          <ClipboardCheck className="size-3.5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-5 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide",
                                f.classification === "needs_facility_referral"
                                  ? "border-orange-300 text-orange-700"
                                  : "border-amber-300 text-amber-700"
                              )}
                            >
                              {CLASS_LABEL[f.classification] ?? f.classification}
                            </Badge>
                            {f.aggregateTag && (
                              <span className="truncate text-[11px] text-muted-foreground">
                                {f.aggregateTag.replace(/_/g, " ")}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>
                              {f.county}
                              {f.ward ? ` · ${f.ward}` : ""}
                            </span>
                            <span aria-hidden>·</span>
                            <span
                              className={cn(
                                "inline-flex items-center gap-0.5 font-medium",
                                due.overdue
                                  ? "text-red-600 dark:text-red-400"
                                  : due.soon
                                    ? "text-amber-600 dark:text-amber-400"
                                    : ""
                              )}
                            >
                              {due.overdue ? (
                                <AlertCircle className="size-3" aria-hidden />
                              ) : (
                                <Clock className="size-3" aria-hidden />
                              )}
                              {due.label}
                            </span>
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        ) : (
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                      </button>

                      {/* Expanded content */}
                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-2.5 space-y-2.5 border-t border-border/40 pt-2.5">
                              {f.chpNextAction && (
                                <p className="text-xs">
                                  <span className="font-semibold text-foreground">Recommended action: </span>
                                  <span className="text-muted-foreground">{f.chpNextAction}</span>
                                </p>
                              )}
                              <div className="space-y-1">
                                <Label htmlFor={`note-${f.id}`} className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Resolution note (de-identified — no names/addresses)
                                </Label>
                                <Textarea
                                  id={`note-${f.id}`}
                                  value={note}
                                  onChange={(e) => setNote(e.target.value)}
                                  placeholder="e.g. Revisited household, mother's sleep improving."
                                  className="min-h-[60px] text-xs"
                                />
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-8 flex-1 bg-emerald-600 hover:bg-emerald-700"
                                  disabled={resolvingId === f.id}
                                  onClick={() => handleResolve(f.id, "done")}
                                >
                                  <Check className="size-3.5" aria-hidden />
                                  Mark done
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 flex-1 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300"
                                  disabled={resolvingId === f.id}
                                  onClick={() => handleResolve(f.id, "missed")}
                                >
                                  <X className="size-3.5" aria-hidden />
                                  Mark missed
                                </Button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
