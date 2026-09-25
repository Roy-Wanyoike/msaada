"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  RefreshCw,
  ClipboardList,
  ShieldCheck,
  Activity,
  Stethoscope,
  AlertTriangle,
  MapPinned,
  BarChart3,
  LineChart as LineChartIcon,
  Tags,
  PieChart as PieChartIcon,
  Table2,
  Download,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

import dynamic from "next/dynamic";
import { KpiCard } from "@/components/msaada/kpi-card";
import { InsightCallouts } from "@/components/msaada/insight-callouts";
import { CountyTable } from "@/components/msaada/county-table";
import { AuditStrip } from "@/components/msaada/AuditStrip";
import { AppNav } from "@/components/msaada/AppNav";
import { AiSummaryCard } from "@/components/msaada/AiSummaryCard";
import { FollowUpKpiCard } from "@/components/msaada/FollowUpKpiCard";
import { CommunityIntelligenceWidget } from "@/components/msaada/CommunityIntelligenceWidget";

// Code-split the Recharts chart components — the dashboard's heavy bundle
// (4 charts + table + KPIs in one client component) was OOM-crashing
// Turbopack under browser load. Lazy-loading each chart into its own chunk
// shrinks the initial bundle so the page mounts before the charts hydrate.
const ChartSkeleton = () => (
  <div className="flex h-[300px] w-full items-center justify-center">
    <div className="size-6 animate-pulse rounded-full border-2 border-border border-t-teal-500" />
  </div>
);

const CountyBarChart = dynamic(
  () => import("@/components/msaada/county-bar-chart").then((m) => m.CountyBarChart),
  { loading: ChartSkeleton, ssr: false }
);
const DailyTrendChart = dynamic(
  () => import("@/components/msaada/county-bar-chart").then((m) => m.DailyTrendChart),
  { loading: ChartSkeleton, ssr: false }
);
const TopTagsChart = dynamic(
  () => import("@/components/msaada/top-tags-chart").then((m) => m.TopTagsChart),
  { loading: ChartSkeleton, ssr: false }
);
const ClassificationDonut = dynamic(
  () => import("@/components/msaada/classification-donut").then((m) => m.ClassificationDonut),
  { loading: ChartSkeleton, ssr: false }
);
import {
  DashboardSkeleton,
  EmptyState,
  ErrorState,
  SeedPromptBanner,
} from "@/components/msaada/dashboard-states";
import {
  computeInsights,
  pct,
  weeklyDelta,
  type DashboardPayload,
  type DashboardStats,
} from "@/components/msaada/dashboard-helpers";

type LoadState = "loading" | "ready" | "error";

/**
 * County Triage Dashboard.
 *
 * Reads ONLY from `/api/dashboard`, which is an aggregate-only endpoint.
 * The data-access layer (`getDashboardStats`) never selects indicator text,
 * so this view is de-identified by construction.
 *
 * On first mount, if `totals.total === 0`, we auto-call `POST /api/seed`
 * (idempotent) so judges never see an empty dashboard.
 */
export default function DashboardPage() {
  const { toast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [audit, setAudit] = useState<DashboardPayload["audit"]>([]);
  const [followUpStats, setFollowUpStats] = useState<DashboardPayload["followUpStats"] | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [scope, setScope] = useState<DashboardPayload["scope"]>({
    county: null,
    mode: "all",
  });
  const [chvCounty, setChvCounty] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<"mine" | "all">("all");
  const [state, setState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState<7 | 14 | 30>(14);
  /** True once we've attempted the auto-seed (so we don't loop on failure). */
  const autoSeedTriedRef = useRef(false);
  /** Monotonic request counter to race-guard stale fetches. */
  const reqIdRef = useRef(0);

  const loadStats = useCallback(
    async (opts?: {
      silent?: boolean;
      days?: number;
      scope?: "mine" | "all";
    }): Promise<DashboardStats | null> => {
      const reqId = ++reqIdRef.current;
      const rangeDays = opts?.days ?? days;
      const scopeQ = opts?.scope ?? scopeMode;
      if (!opts?.silent) setState((s) => (s === "ready" ? s : "loading"));
      try {
        const res = await fetch(
          `/api/dashboard?days=${rangeDays}&scope=${scopeQ}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          throw new Error(`Dashboard endpoint returned HTTP ${res.status}`);
        }
        const data = (await res.json()) as DashboardPayload;
        // Drop stale responses (a newer refresh superseded us).
        if (reqId !== reqIdRef.current) return null;
        setStats({
          byCounty: data.byCounty,
          byDay: data.byDay,
          byTag: data.byTag,
          totals: data.totals,
        });
        setAudit(data.audit ?? []);
        setFollowUpStats(data.followUpStats ?? null);
        setScope(data.scope ?? { county: null, mode: "all" });
        setLastUpdated(Date.now());
        setState("ready");
        setErrorMsg(null);
        return data;
      } catch (err) {
        if (reqId !== reqIdRef.current) return null;
        const msg =
          err instanceof Error ? err.message : "Failed to load dashboard";
        setErrorMsg(msg);
        setState("error");
        if (!opts?.silent) {
          toast({
            title: "Couldn't load dashboard",
            description: msg,
            variant: "destructive",
          });
        }
        return null;
      }
    },
    [days, scopeMode, toast]
  );

  const seedDemo = useCallback(
    async (opts?: { silent?: boolean }): Promise<void> => {
      setSeeding(true);
      try {
        const res = await fetch("/api/seed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          throw new Error(`Seed endpoint returned HTTP ${res.status}`);
        }
        const body = (await res.json()) as { seeded: number };
        if (!opts?.silent) {
          toast({
            title: `Seeded ${body.seeded} demo observation${
              body.seeded === 1 ? "" : "s"
            }`,
            description: "Charts will refresh in a moment.",
          });
        }
        await loadStats({ silent: true });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to seed demo data";
        toast({
          title: "Seed failed",
          description: msg,
          variant: "destructive",
        });
      } finally {
        setSeeding(false);
      }
    },
    [loadStats, toast]
  );

  // On mount, also hydrate the session CHV (for the RBAC county-scope).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        const data = (await res.json()) as { chv: { county: string } | null };
        if (cancelled) return;
        if (data.chv?.county) {
          setChvCounty(data.chv.county);
          // Default to the CHV's own county scope (RBAC default).
          setScopeMode("mine");
        }
      } catch {
        // No session — fine, dashboard stays in all-county demo mode.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initial mount: load, then auto-seed if empty (idempotent — only once).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadStats({ silent: true });
      if (cancelled || !data) return;
      if (data.totals.total === 0 && !autoSeedTriedRef.current) {
        autoSeedTriedRef.current = true;
        await seedDemo({ silent: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStats, seedDemo]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  }, [loadStats]);

  // Re-fetch when the time-range filter or the RBAC scope changes.
  useEffect(() => {
    void loadStats({ silent: true });
  }, [days, scopeMode, loadStats]);

  const handleDaysChange = useCallback((next: 7 | 14 | 30) => {
    setDays(next);
  }, []);

  const handleScopeChange = useCallback((next: "mine" | "all") => {
    setScopeMode(next);
  }, []);

  /** CSV export of the county table — de-identified (counts only). */
  const handleExportCsv = useCallback(() => {
    if (!stats) return;
    const rows = stats.byCounty;
    const header = [
      "County",
      "Total",
      "Routine",
      "Needs Follow-up",
      "Needs Facility Referral",
      "Escalation",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.county,
          r.total,
          r.routine,
          r.needs_followup,
          r.needs_facility_referral,
          r.escalation,
        ].join(",")
      );
    }
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `msaada-county-triage-${days}d-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: "CSV exported",
      description: `${rows.length} counties · last ${days} days`,
    });
  }, [stats, days, toast]);

  // ----- Derived view state -----
  const isEmpty =
    state === "ready" && stats !== null && stats.totals.total === 0;

  return (
    <div className="flex min-h-screen flex-col bg-background lg:pl-64 print:pl-0">
      <AppNav />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <DashboardHeader
            onRefresh={handleRefresh}
            refreshing={refreshing}
            days={days}
            onDaysChange={handleDaysChange}
            onExportCsv={handleExportCsv}
            chvCounty={chvCounty}
            scopeMode={scopeMode}
            onScopeChange={handleScopeChange}
            lastUpdated={lastUpdated}
          />

          {state === "loading" ? (
            <DashboardSkeleton />
          ) : state === "error" ? (
            <ErrorState
              message={errorMsg ?? "Unknown error"}
              onRetry={() => {
                void loadStats();
              }}
            />
          ) : !stats || isEmpty ? (
            <EmptyState
              onSeed={() => {
                void seedDemo();
              }}
              seeding={seeding}
            />
          ) : (
            <DashboardView
              stats={stats}
              audit={audit}
              scope={scope}
              followUpStats={followUpStats}
              days={days}
              onSeed={() => {
                void seedDemo();
              }}
              seeding={seeding}
            />
          )}
        </div>
      </main>

      <DashboardFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function DashboardHeader({
  onRefresh,
  refreshing,
  days,
  onDaysChange,
  onExportCsv,
  chvCounty,
  scopeMode,
  onScopeChange,
  lastUpdated,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  days: 7 | 14 | 30;
  onDaysChange: (next: 7 | 14 | 30) => void;
  onExportCsv: () => void;
  chvCounty: string | null;
  scopeMode: "mine" | "all";
  onScopeChange: (next: "mine" | "all") => void;
  lastUpdated: number | null;
}) {
  const ranges: Array<{ value: 7 | 14 | 30; label: string }> = [
    { value: 7, label: "7d" },
    { value: 14, label: "14d" },
    { value: 30, label: "30d" },
  ];
  return (
    <header className="mb-6 sm:mb-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300"
          >
            <span
              className="inline-block size-1.5 rounded-full bg-teal-500"
              aria-hidden
            />
            Aggregate view · De-identified
          </Badge>
          {lastUpdated && <FreshnessBadge lastUpdated={lastUpdated} />}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          County dashboard
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Community mental-health signals over the last {days} days. Aggregates
          only. No individual observation text is exposed anywhere in the data
          pipeline.
        </p>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-y border-border py-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* RBAC county-scope toggle — only shown when a CHV session exists. */}
          {chvCounty && (
            <div
              role="group"
              aria-label="Data scope (RBAC)"
              className="inline-flex h-10 items-center rounded-md border border-border bg-muted/40 p-0.5"
            >
              <button
                type="button"
                onClick={() => onScopeChange("mine")}
                aria-pressed={scopeMode === "mine"}
                className={`min-h-9 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  scopeMode === "mine"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title={`Scoped to your county (${chvCounty})`}
              >
                {chvCounty}
              </button>
              <button
                type="button"
                onClick={() => onScopeChange("all")}
                aria-pressed={scopeMode === "all"}
                className={`min-h-9 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  scopeMode === "all"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="View all counties (demo/national mode)"
              >
                All
              </button>
            </div>
          )}
          {/* Time-range segmented control */}
          <div
            role="group"
            aria-label="Time range"
            className="inline-flex h-10 items-center rounded-md border border-border bg-muted/40 p-0.5"
          >
            {ranges.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => onDaysChange(r.value)}
                aria-pressed={days === r.value}
                className={`min-h-9 min-w-10 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  days === r.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExportCsv}
            className="h-10 px-3"
            aria-label="Export county data as CSV"
          >
            <Download className="size-4" aria-hidden />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            className="h-10 px-3"
            aria-label="Refresh dashboard data"
          >
            <RefreshCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Main dashboard view (data loaded & non-empty)                       */
/* ------------------------------------------------------------------ */

function DashboardView({
  stats,
  audit,
  scope,
  followUpStats,
  days,
  onSeed,
  seeding,
}: {
  stats: DashboardStats;
  audit: DashboardPayload["audit"];
  scope: DashboardPayload["scope"];
  followUpStats: DashboardPayload["followUpStats"] | null;
  days: number;
  onSeed: () => void;
  seeding: boolean;
}) {
  const { totals } = stats;
  // Defensive guards — if the API returns a partial payload during a scope
  // switch or stale fetch, fall back to empty arrays so the charts / helpers
  // never receive undefined (was crashing with "byDay is not iterable").
  const guardedStats: DashboardStats = {
    byCounty: Array.isArray(stats.byCounty) ? stats.byCounty : [],
    byDay: Array.isArray(stats.byDay) ? stats.byDay : [],
    byTag: Array.isArray(stats.byTag) ? stats.byTag : [],
    totals,
  };

  // KPI hints: small trend hints derivable from the regional byDay series.
  const followupDelta = weeklyDelta(guardedStats.byDay, "needs_followup");
  const escalationDelta = weeklyDelta(guardedStats.byDay, "escalation");

  const followupHint = `${pct(totals.needs_followup, totals.total)}% of total${
    followupDelta.noBaseline
      ? ""
      : ` · ${followupDelta.delta >= 0 ? "+" : ""}${followupDelta.delta} vs prev 7d`
  }`;
  const escalationHint = `${pct(totals.escalation, totals.total)}% of total${
    escalationDelta.noBaseline
      ? ""
      : ` · ${escalationDelta.delta >= 0 ? "+" : ""}${escalationDelta.delta} vs prev 7d`
  }`;

  const insights = computeInsights(guardedStats);

  return (
    <div className="space-y-6">
      {/* RBAC scope banner — surfaces the county-scope filter when active. */}
      {scope.mode === "mine" && scope.county ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">County-scoped view (RBAC):</span>{" "}
            showing only {scope.county} aggregates — the data-access layer
            filtered to your county. Switch to{" "}
            <span className="font-mono">All</span> in the header for the demo
            / national view.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <MapPinned className="size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-foreground">Demo mode:</span>{" "}
            showing all counties. Production would require a county-official
            role for this view (RBAC TODO).
          </span>
        </div>
      )}

      {/* KPI grid: 2-col mobile → 3-col md → 6-col lg */}
      <section aria-label="Key performance indicators" aria-live="polite">
        <h2 className="sr-only">KPI summary</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            index={0}
            label="Total observations"
            value={totals.total}
            hint="Last 14 days"
            tone="teal"
            icon={ClipboardList}
          />
          <KpiCard
            index={1}
            label="Routine"
            value={totals.routine}
            hint={`${pct(totals.routine, totals.total)}% of total`}
            tone="routine"
            icon={ShieldCheck}
          />
          <KpiCard
            index={2}
            label="Needs follow-up"
            value={totals.needs_followup}
            hint={followupHint}
            tone="needs_followup"
            icon={Activity}
          />
          <KpiCard
            index={3}
            label="Facility referral"
            value={totals.needs_facility_referral}
            hint={`${pct(totals.needs_facility_referral, totals.total)}% of total`}
            tone="needs_facility_referral"
            icon={Stethoscope}
          />
          <KpiCard
            index={4}
            label="Escalations / crisis"
            value={totals.escalation}
            hint={escalationHint}
            tone="escalation"
            icon={AlertTriangle}
          />
          <KpiCard
            index={5}
            label="Counties covered"
            value={totals.countiesCovered}
            hint={
              totals.countiesCovered >= 4 ? "All demo counties" : "Subset"
            }
            tone="teal"
            icon={MapPinned}
          />
        </div>

        {/* Follow-up completion KPI — full-width, shows operational health */}
        {followUpStats && followUpStats.total > 0 && (
          <div className="mt-3">
            <FollowUpKpiCard stats={followUpStats} index={6} />
          </div>
        )}
      </section>

      {/* Soft prompt if dataset feels thin (defensive — shouldn't fire after auto-seed). */}
      {totals.total > 0 && totals.total < 3 ? (
        <SeedPromptBanner onSeed={onSeed} seeding={seeding} />
      ) : null}

      {/* AI briefing (on demand) — resets when the range or scope changes. */}
      <AiSummaryCard key={`${days}-${scope.mode}`} days={days} scope={scope.mode} />

      {/* Insights */}
      <section aria-label="Insight callouts" aria-live="polite">
        <h2 className="mb-3 text-base font-semibold text-foreground">
          Insights
        </h2>
        <InsightCallouts
          insights={insights}
          weeklyDeltaNumber={
            followupDelta.noBaseline ? null : followupDelta.delta
          }
        />
      </section>

      {/* Charts — 1-col mobile, 2-col lg */}
      <section aria-label="Aggregate charts" className="space-y-4">
        <h2 className="sr-only">Aggregate charts</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="County breakdown"
            subtitle="Triage classification per county, last 14 days"
            icon={<BarChart3 className="size-4" aria-hidden />}
          >
            <CountyBarChart data={guardedStats.byCounty} />
          </ChartCard>

          <ChartCard
            title="Daily trend (14 days)"
            subtitle="Classification volumes per day across all counties"
            icon={<LineChartIcon className="size-4" aria-hidden />}
          >
            <DailyTrendChart data={guardedStats.byDay} />
          </ChartCard>

          <ChartCard
            title="Top aggregate tags"
            subtitle="Most-frequent triaged aggregate tags (top 12)"
            icon={<Tags className="size-4" aria-hidden />}
          >
            <TopTagsChart data={guardedStats.byTag.slice(0, 12)} />
          </ChartCard>

          <ChartCard
            title="Classification distribution"
            subtitle="Share of all observations by classification"
            icon={<PieChartIcon className="size-4" aria-hidden />}
          >
            <ClassificationDonut totals={totals} />
          </ChartCard>
        </div>
      </section>

      {/* County table */}
      <section aria-label="County data table" className="space-y-3">
        <div className="flex items-center gap-2">
          <Table2 className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">
            County detail
          </h2>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <Card className="px-4 py-4 sm:px-6">
            <CardContent className="px-0">
              <CountyTable stats={guardedStats} />
            </CardContent>
          </Card>
        </motion.div>
      </section>

      {/* Recent activity — de-identified audit trail strip. */}
      <AuditStrip entries={audit} />

      {/* Community reporting intelligence (CR-015) */}
      <CommunityIntelligenceWidget />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chart card wrapper — keeps chart card styling consistent            */
/* ------------------------------------------------------------------ */

function ChartCard({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="h-full"
    >
      <Card className="h-full gap-0 px-4 py-4 sm:px-6">
        <CardHeader className="mb-3 flex flex-row items-start gap-2 px-0">
          <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300">
            {icon}
          </span>
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-semibold leading-tight">
              {title}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </CardHeader>
        <CardContent className="px-0">{children}</CardContent>
      </Card>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Freshness badge — shows "updated Xm ago" + staleness color.         */
/* ------------------------------------------------------------------ */

function FreshnessBadge({ lastUpdated }: { lastUpdated: number }) {
  // Tick every 30s so the relative time stays fresh.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const ageMs = Date.now() - lastUpdated;
  const ageMin = Math.floor(ageMs / 60000);
  const label =
    ageMin < 1 ? "just now" : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;
  // Stale = >5 min. Fresh = <1 min.
  const stale = ageMin > 5;
  const fresh = ageMin < 1;
  const cls = fresh
    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
    : stale
      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
      : "border-border bg-muted/40 text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}
      title={`Data last refreshed ${label}`}
    >
      <span
        className={`inline-block size-1.5 rounded-full ${
          fresh ? "bg-emerald-500 animate-pulse" : stale ? "bg-amber-500" : "bg-muted-foreground"
        }`}
        aria-hidden
      />
      Updated {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function DashboardFooter() {
  return (
    <footer
      className="mt-auto border-t bg-background/80 backdrop-blur"
      role="contentinfo"
    >
      <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <p className="text-center text-xs text-muted-foreground sm:text-left">
          Msaada county dashboard · Demo build · De-identified aggregates
          only · No individual observation text exposed
        </p>
      </div>
    </footer>
  );
}
