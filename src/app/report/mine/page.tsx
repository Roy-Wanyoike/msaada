"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Printer,
  ShieldCheck,
  Activity,
  Stethoscope,
  AlertTriangle,
  ClipboardList,
  FileText,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AppNav } from "@/components/msaada/AppNav";
import type { TriageRecordDTO, Classification } from "@/lib/types";

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

interface ChvInfo {
  fullName: string;
  county: string;
  ward: string;
}

type LoadState = "loading" | "ready" | "error" | "unauthed";

const CLASS_LABEL: Record<Classification, string> = {
  routine: "Routine",
  needs_followup: "Needs follow-up",
  needs_facility_referral: "Facility referral",
};

const CLASS_TONE: Record<Classification | "crisis", { soft: string; text: string; dot: string }> = {
  routine: { soft: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  needs_followup: { soft: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  needs_facility_referral: { soft: "bg-orange-50 dark:bg-orange-950/40", text: "text-orange-700 dark:text-orange-300", dot: "bg-orange-500" },
  crisis: { soft: "bg-red-50 dark:bg-red-950/40", text: "text-red-700 dark:text-red-300", dot: "bg-red-500" },
};

function classIcon(c: Classification, escalation: boolean) {
  if (escalation) return AlertTriangle;
  if (c === "routine") return ShieldCheck;
  if (c === "needs_followup") return Activity;
  return Stethoscope;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * `/report/mine` — a printable weekly CHV report. Leverages getMyStats +
 * getMyRecords to produce a de-identified personal summary the CHV can
 * print or share with their supervisor. Includes a print stylesheet
 * (hide nav, expand content) via the `print:` Tailwind variant.
 */
export default function ReportPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [stats, setStats] = useState<ChvStats | null>(null);
  const [records, setRecords] = useState<TriageRecordDTO[]>([]);
  const [chv, setChv] = useState<ChvInfo | null>(null);

  const load = useCallback(async () => {
    try {
      const [meRes, statsRes, recRes] = await Promise.all([
        fetch("/api/auth/me", { credentials: "same-origin" }),
        fetch("/api/stats/mine", { credentials: "same-origin" }),
        fetch("/api/records/mine?limit=20", { credentials: "same-origin" }),
      ]);
      const me = await meRes.json();
      if (!me.chv) {
        setState("unauthed");
        return;
      }
      setChv(me.chv);
      if (!statsRes.ok) throw new Error("stats failed");
      if (!recRes.ok) throw new Error("records failed");
      setStats(await statsRes.json());
      setRecords((await recRes.json()).records ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const delta = stats ? stats.last7d - stats.prev7d : 0;
  const trendUp = delta > 0;
  const trendNeutral = delta === 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="print:hidden">
        <AppNav />
      </div>
      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {/* Header (hidden in print) */}
          <header className="mb-6 print:hidden sm:mb-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
                  <FileText className="mr-1 size-3" aria-hidden />
                  Weekly CHV report
                </Badge>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  My triage report
                </h1>
                <p className="max-w-2xl text-sm text-foreground/70">
                  A de-identified summary of your home-visit observations.
                  Print or share with your supervisor for weekly review.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button asChild variant="outline" size="sm" className="h-10 min-h-[44px] px-3">
                  <Link href="/" aria-label="Back to CHV submission">
                    <ArrowLeft className="size-4" aria-hidden />
                    <span className="hidden sm:inline">Back</span>
                  </Link>
                </Button>
                <Button
                  onClick={handlePrint}
                  size="sm"
                  className="h-10 min-h-[44px] bg-emerald-600 px-3 hover:bg-emerald-700 print:hidden"
                  disabled={state !== "ready"}
                >
                  <Printer className="size-4" aria-hidden />
                  <span className="hidden sm:inline">Print</span>
                </Button>
              </div>
            </div>
            <Separator className="mt-6" />
          </header>

          {state === "loading" ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-64 w-full rounded-lg" />
            </div>
          ) : state === "unauthed" ? (
            <Card className="px-6 py-12 text-center">
              <FileText className="mx-auto size-8 text-muted-foreground/50" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                Sign in to view your weekly report.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/">Sign in</Link>
              </Button>
            </Card>
          ) : state === "error" || !stats || !chv ? (
            <Card className="px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load your report.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
                Retry
              </Button>
            </Card>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-5"
            >
              {/* Print header (only in print) */}
              <div className="hidden print:block">
                <h1 className="text-xl font-bold">Msaada — CHV Weekly Report</h1>
                <p className="text-sm">{chv.fullName} · {chv.county}{chv.ward ? `, ${chv.ward}` : ""}</p>
                <p className="text-xs text-muted-foreground">Generated {fmtDate(new Date().toISOString())}</p>
                <hr className="my-3" />
              </div>

              {/* CHV identity + summary */}
              <Card className="px-4 py-4 sm:px-6">
                <CardContent className="px-0">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Community Health Volunteer
                      </p>
                      <p className="mt-1 text-lg font-bold text-foreground">{chv.fullName}</p>
                      <p className="text-sm text-muted-foreground">
                        {chv.county}{chv.ward ? ` · ${chv.ward}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Active since
                      </p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {stats.firstSubmission ? fmtDate(stats.firstSubmission) : "—"}
                      </p>
                    </div>
                  </div>
                  <Separator className="my-4" />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <SummaryStat label="Total observations" value={stats.total} icon={ClipboardList} tone="teal" />
                    <SummaryStat label="This week" value={stats.last7d} icon={trendUp ? TrendingUp : trendNeutral ? Activity : TrendingDown} tone={trendNeutral ? "teal" : trendUp ? "amber" : "emerald"} hint={stats.prev7d > 0 ? `${delta >= 0 ? "+" : ""}${delta} vs last week` : undefined} />
                    <SummaryStat label="Escalations" value={stats.escalation} icon={AlertTriangle} tone="red" />
                    <SummaryStat label="Counties" value={stats.countiesCovered} icon={FileText} tone="teal" />
                  </div>
                </CardContent>
              </Card>

              {/* Breakdown bar */}
              <Card className="px-4 py-4 sm:px-6">
                <CardHeader className="px-0 pb-3">
                  <CardTitle className="text-sm font-semibold">Classification breakdown</CardTitle>
                </CardHeader>
                <CardContent className="px-0">
                  <BreakdownBar stats={stats} />
                </CardContent>
              </Card>

              {/* Recent records (de-identified, condensed) */}
              <Card className="px-4 py-4 sm:px-6">
                <CardHeader className="px-0 pb-3">
                  <CardTitle className="text-sm font-semibold">
                    Recent observations ({records.length})
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    De-identified — no observation text stored.
                  </p>
                </CardHeader>
                <CardContent className="px-0">
                  {records.length === 0 ? (
                    <p className="py-3 text-center text-sm text-muted-foreground">
                      No observations yet.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {records.slice(0, 12).map((r) => {
                        const tone = r.escalation ? CLASS_TONE.crisis : CLASS_TONE[r.classification];
                        const Icon = classIcon(r.classification, r.escalation);
                        return (
                          <li
                            key={r.id}
                            className="flex items-center gap-2.5 rounded-md border border-border/40 bg-muted/20 px-3 py-2"
                          >
                            <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded", tone.soft, tone.text)}>
                              <Icon className="size-3" aria-hidden />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-foreground">
                                  {r.escalation ? "Crisis override" : CLASS_LABEL[r.classification]}
                                </span>
                                {r.aggregateTag && (
                                  <span className="truncate text-[11px] text-muted-foreground">
                                    {r.aggregateTag.replace(/_/g, " ")}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                {fmtDate(r.createdAt)} · {r.county}{r.ward ? ` · ${r.ward}` : ""}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <p className="px-2 text-center text-[11px] text-muted-foreground print:mt-4">
                Msaada · De-identified weekly report · Not a diagnostic tool ·
                Crisis line: Kenya Red Cross 1199 / Befrienders Kenya +254 722 178 177
              </p>
            </motion.div>
          )}
        </div>
      </main>

      <footer className="mt-auto border-t bg-background/80 backdrop-blur print:hidden" role="contentinfo">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            Msaada weekly report · De-identified · Ownership-scoped (your records only)
          </p>
        </div>
      </footer>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  icon: typeof ShieldCheck;
  tone: "teal" | "emerald" | "amber" | "red";
  hint?: string;
}) {
  const toneCls = {
    teal: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    red: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  }[tone];
  return (
    <div className={cn("rounded-md border border-border/40 px-3 py-2", toneCls)}>
      <div className="flex items-center gap-1">
        <Icon className="size-3" aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</span>
      </div>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] opacity-80">{hint}</p>}
    </div>
  );
}

function BreakdownBar({ stats }: { stats: ChvStats }) {
  const total = stats.total || 1;
  const segments = [
    { label: "Routine", value: stats.routine, color: "bg-emerald-500" },
    { label: "Follow-up", value: stats.needs_followup, color: "bg-amber-500" },
    { label: "Referral", value: stats.needs_facility_referral, color: "bg-orange-500" },
    { label: "Escalation", value: stats.escalation, color: "bg-red-500" },
  ];
  return (
    <div>
      <div className="flex h-8 w-full overflow-hidden rounded-md border border-border/40">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className={cn(s.color, "flex items-center justify-center text-[10px] font-bold text-white")}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            >
              {s.value > 0 && (s.value / total) > 0.08 ? s.value : ""}
            </div>
          ) : null
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className={cn("size-2 rounded-sm", s.color)} aria-hidden />
            {s.label}: <span className="font-medium text-foreground tabular-nums">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
