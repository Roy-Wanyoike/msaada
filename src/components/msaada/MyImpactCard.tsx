"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  HeartPulse,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Activity,
  Stethoscope,
  AlertTriangle,
  CalendarDays,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChvStats {
  total: number;
  routine: number;
  needs_followup: number;
  needs_facility_referral: number;
  escalation: number;
  last7d: number;
  prev7d: number;
  firstSubmission: string | null;
  countiesCovered: number;
}

interface Props {
  /** Bumped by the parent whenever a new triage result lands, to trigger a refetch. */
  refreshKey: number;
}

type LoadState = "loading" | "ready" | "error";

function fmtSince(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return "today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/**
 * "My impact" — a CHV-facing card showing their personal de-identified
 * aggregate stats (ownership-scoped via /api/stats/mine). Gives the CHV a
 * sense of their contribution without exposing other CHVs' data.
 */
export function MyImpactCard({ refreshKey }: Props) {
  const [state, setState] = useState<LoadState>("loading");
  const [stats, setStats] = useState<ChvStats | null>(null);

  const load = useCallback(async () => {
    setState((s) => (s === "ready" ? s : "loading"));
    try {
      const res = await fetch("/api/stats/mine", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.status === 401) {
        setStats(null);
        setState("ready");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ChvStats;
      setStats(data);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const delta = stats ? stats.last7d - stats.prev7d : 0;
  const trendUp = delta > 0;
  const trendNeutral = delta === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center gap-2 px-4 py-3 sm:px-6">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
            <HeartPulse className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-semibold leading-tight">
              My impact
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {state === "ready" && stats
                ? `${stats.total} observation${stats.total === 1 ? "" : "s"} since ${fmtSince(stats.firstSubmission)}`
                : state === "loading"
                  ? "Loading…"
                  : "Couldn't load"}
            </p>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6">
          {state === "loading" ? (
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-md" />
              ))}
            </div>
          ) : state === "error" || !stats ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Couldn&apos;t load your stats.{" "}
              <button
                type="button"
                onClick={() => void load()}
                className="font-medium text-foreground underline underline-offset-2"
              >
                Retry
              </button>
            </p>
          ) : (
            <>
              {/* Top stat row */}
              <div className="mb-3 flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    This week
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {stats.last7d}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      / {stats.total} total
                    </span>
                  </p>
                </div>
                {stats.prev7d > 0 && (
                  <div
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold",
                      trendNeutral
                        ? "bg-muted text-muted-foreground"
                        : trendUp
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    )}
                  >
                    {trendNeutral ? (
                      "—"
                    ) : trendUp ? (
                      <TrendingUp className="size-3" aria-hidden />
                    ) : (
                      <TrendingDown className="size-3" aria-hidden />
                    )}
                    {trendNeutral ? "flat" : `${delta > 0 ? "+" : ""}${delta} vs last week`}
                  </div>
                )}
              </div>

              {/* Breakdown grid */}
              <div className="grid grid-cols-2 gap-2">
                <StatTile
                  icon={ShieldCheck}
                  label="Routine"
                  value={stats.routine}
                  tone="emerald"
                />
                <StatTile
                  icon={Activity}
                  label="Follow-up"
                  value={stats.needs_followup}
                  tone="amber"
                />
                <StatTile
                  icon={Stethoscope}
                  label="Referral"
                  value={stats.needs_facility_referral}
                  tone="orange"
                />
                <StatTile
                  icon={AlertTriangle}
                  label="Escalations"
                  value={stats.escalation}
                  tone="red"
                />
              </div>

              {/* Footer meta */}
              <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="size-3" aria-hidden />
                  Since {fmtSince(stats.firstSubmission)}
                </span>
                <span aria-hidden>·</span>
                <span>{stats.countiesCovered} count{stats.countiesCovered === 1 ? "y" : "ies"}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

const TONE_STYLES: Record<string, { soft: string; text: string }> = {
  emerald: { soft: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300" },
  amber: { soft: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-300" },
  orange: { soft: "bg-orange-50 dark:bg-orange-950/40", text: "text-orange-700 dark:text-orange-300" },
  red: { soft: "bg-red-50 dark:bg-red-950/40", text: "text-red-700 dark:text-red-300" },
};

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: number;
  tone: keyof typeof TONE_STYLES;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className={cn("inline-flex size-5 items-center justify-center rounded", t.soft, t.text)}>
          <Icon className="size-3" aria-hidden />
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="mt-1.5 text-xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
