"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  RefreshCw,
  Users,
  ShieldCheck,
  Activity,
  Stethoscope,
  AlertTriangle,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { COUNTIES } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppNav } from "@/components/msaada/AppNav";
import { AiSummaryCard } from "@/components/msaada/AiSummaryCard";
import { UnassignedCasesPanel } from "@/components/msaada/UnassignedCasesPanel";

interface SupervisorChvRow {
  chvLabel: string;
  county: string;
  ward: string | null;
  total: number;
  routine: number;
  needs_followup: number;
  needs_facility_referral: number;
  escalation: number;
  last7d: number;
  lastSubmission: string | null;
}

interface SupervisorRoster {
  rows: SupervisorChvRow[];
  totals: { chvs: number; total: number; escalations: number };
}

type LoadState = "loading" | "ready" | "error";

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const hr = Math.floor(diff / 3600000);
  if (hr < 1) return "just now";
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function SupervisorPage() {
  const [data, setData] = useState<SupervisorRoster | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [county, setCounty] = useState<string>("all");
  const [days, setDays] = useState<7 | 14 | 30>(14);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const c = county !== "all" ? `&county=${county}` : "";
      const res = await fetch(`/api/supervisor/roster?days=${days}${c}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setState("ready");
    } catch {
      setState("error");
    }
  }, [county, days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex min-h-screen flex-col bg-background lg:pl-64 print:pl-0">
      <AppNav />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {/* Header */}
          <header className="mb-6 sm:mb-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <Badge
                  variant="outline"
                  className="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300"
                >
                  <Users className="mr-1 size-3" aria-hidden />
                  Supervisor view · De-identified
                </Badge>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  CHV roster
                </h1>
                <p className="max-w-2xl text-sm text-foreground/70">
                  Per-CHV aggregate activity, load, and escalation burden.
                  De-identified — truncated CHV labels, never emails or
                  observation text. For supervisor workload review.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void load()}
                  className="h-10 min-h-[44px] px-3"
                  aria-label="Refresh roster"
                >
                  <RefreshCw className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
            <Separator className="mt-6" />
          </header>

          {/* Qwen: cases waiting for a CHV, with suggested assignments. */}
          <UnassignedCasesPanel />

          <div className="mb-6">
            <AiSummaryCard
              key={`${days}-${county}`}
              endpoint={`/api/supervisor/briefing?days=${days}${county !== "all" ? `&county=${encodeURIComponent(county)}` : ""}`}
              title="Qwen workload briefing"
              description="Written from the roster below (anonymised CHV labels, counts only)."
            />
          </div>

          {/* Filters */}
          <Card className="mb-4 px-4 py-3 sm:px-6">
            <CardContent className="flex flex-wrap items-end gap-3 px-0">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Filter className="mr-1 inline size-3" aria-hidden />
                  County
                </p>
                <Select value={county} onValueChange={setCounty}>
                  <SelectTrigger className="h-9 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All counties</SelectItem>
                    {COUNTIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Range
                </p>
                <div
                  role="group"
                  aria-label="Time range"
                  className="inline-flex h-9 items-center rounded-md border border-border bg-muted/40 p-0.5"
                >
                  {([7, 14, 30] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDays(d)}
                      aria-pressed={days === d}
                      className={cn(
                        "min-h-8 min-w-9 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        days === d
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
              <div className="ml-auto text-xs text-muted-foreground">
                {data ? `${data.totals.chvs} CHV${data.totals.chvs === 1 ? "" : "s"} · ${data.totals.total} observation${data.totals.total === 1 ? "" : "s"}` : "—"}
              </div>
            </CardContent>
          </Card>

          {/* Summary KPIs */}
          {data && (
            <div className="mb-4 grid grid-cols-3 gap-3">
              <SummaryCard label="Active CHVs" value={data.totals.chvs} icon={Users} tone="teal" />
              <SummaryCard label="Total observations" value={data.totals.total} icon={Activity} tone="teal" />
              <SummaryCard label="Escalations" value={data.totals.escalations} icon={AlertTriangle} tone="red" />
            </div>
          )}

          {/* Roster table */}
          {state === "loading" ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-md" />
              ))}
            </div>
          ) : state === "error" ? (
            <Card className="px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load the roster.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
                Retry
              </Button>
            </Card>
          ) : !data || data.rows.length === 0 ? (
            <Card className="px-6 py-12 text-center">
              <Users className="mx-auto size-8 text-muted-foreground/50" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                No CHV activity in this range.
              </p>
            </Card>
          ) : (
            <>
              {/* Desktop header row */}
              <div className="hidden gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[1fr_1.2fr_0.8fr_0.7fr_0.7fr_0.7fr_0.7fr_0.9fr]">
                <span>CHV</span>
                <span>County · Ward</span>
                <span>Total</span>
                <span>Routine</span>
                <span>Follow-up</span>
                <span>Referral</span>
                <span>Escalation</span>
                <span className="text-right">Last active</span>
              </div>
              <Separator className="mb-1" />
              <ul className="space-y-1.5">
                {data.rows.map((r, i) => (
                  <motion.li
                    key={r.chvLabel}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.25) }}
                  >
                    <div className="grid items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2.5 transition-colors hover:bg-muted/30 md:grid-cols-[1fr_1.2fr_0.8fr_0.7fr_0.7fr_0.7fr_0.7fr_0.9fr]">
                      {/* CHV label + 7d activity dot */}
                      <div className="flex items-center gap-2">
                        <span className="inline md:hidden text-muted-foreground mr-1">CHV:</span>
                        <span
                          className={cn(
                            "inline-block size-2 shrink-0 rounded-full",
                            r.last7d > 0 ? "bg-emerald-500" : "bg-muted-foreground/30"
                          )}
                          aria-hidden
                          title={r.last7d > 0 ? `Active this week (${r.last7d})` : "Inactive this week"}
                        />
                        <span className="font-mono text-xs text-foreground">{r.chvLabel}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        <span className="inline md:hidden text-muted-foreground mr-1">County · Ward:</span>
                        {r.county}{r.ward ? ` · ${r.ward}` : ""}
                      </span>
                      <span className="text-sm font-bold tabular-nums text-foreground">
                        <span className="inline md:hidden text-muted-foreground mr-1 font-normal text-xs">Total:</span>
                        {r.total}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                        <span className="inline md:hidden text-muted-foreground mr-1">Routine:</span>
                        <ShieldCheck className="size-3" aria-hidden />
                        {r.routine}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                        <span className="inline md:hidden text-muted-foreground mr-1">Follow-up:</span>
                        <Activity className="size-3" aria-hidden />
                        {r.needs_followup}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-orange-700 dark:text-orange-300">
                        <span className="inline md:hidden text-muted-foreground mr-1">Referral:</span>
                        <Stethoscope className="size-3" aria-hidden />
                        {r.needs_facility_referral}
                      </span>
                      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", r.escalation > 0 ? "text-red-700 dark:text-red-300" : "text-muted-foreground")}>
                        <span className="inline md:hidden text-muted-foreground mr-1 font-normal">Escalation:</span>
                        <AlertTriangle className="size-3" aria-hidden />
                        {r.escalation}
                      </span>
                      <span className="text-left text-[11px] text-muted-foreground md:text-right">
                        <span className="inline md:hidden text-muted-foreground mr-1">Last active:</span>
                        {fmtRelative(r.lastSubmission)}
                      </span>
                    </div>
                  </motion.li>
                ))}
              </ul>
            </>
          )}
        </div>
      </main>

      <footer className="mt-auto border-t bg-background/80 backdrop-blur" role="contentinfo">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            Msaada supervisor roster · De-identified per-CHV aggregates · TODO: supervisor RBAC role for production
          </p>
        </div>
      </footer>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone: "teal" | "red";
}) {
  const toneCls = tone === "red"
    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
    : "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300";
  return (
    <Card className={cn("border px-4 py-3", toneCls)}>
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5" aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </Card>
  );
}
