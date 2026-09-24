"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

import { KpiCard } from "@/components/msaada/kpi-card";
import {
  CountyBarChart,
  DailyTrendChart,
} from "@/components/msaada/county-bar-chart";
import { TopTagsChart } from "@/components/msaada/top-tags-chart";
import { ClassificationDonut } from "@/components/msaada/classification-donut";
import { InsightCallouts } from "@/components/msaada/insight-callouts";
import { CountyTable } from "@/components/msaada/county-table";
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
  const [state, setState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** True once we've attempted the auto-seed (so we don't loop on failure). */
  const autoSeedTriedRef = useRef(false);
  /** Monotonic request counter to race-guard stale fetches. */
  const reqIdRef = useRef(0);

  const loadStats = useCallback(
    async (opts?: { silent?: boolean }): Promise<DashboardStats | null> => {
      const reqId = ++reqIdRef.current;
      if (!opts?.silent) setState((s) => (s === "ready" ? s : "loading"));
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Dashboard endpoint returned HTTP ${res.status}`);
        }
        const data = (await res.json()) as DashboardStats;
        // Drop stale responses (a newer refresh superseded us).
        if (reqId !== reqIdRef.current) return null;
        setStats(data);
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
    [toast]
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

  // ----- Derived view state -----
  const isEmpty =
    state === "ready" && stats !== null && stats.totals.total === 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <DashboardHeader
            onRefresh={handleRefresh}
            refreshing={refreshing}
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
}: {
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <header className="mb-6 sm:mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
            <span className="text-xs text-muted-foreground">
              Last 14 days
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Msaada — County Triage Dashboard
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Aggregate community mental-health triage signals (last 14 days).
            De-identified — no individual observation text is exposed at any
            layer of the data pipeline.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-10 min-h-[44px] px-3"
          >
            <Link href="/" aria-label="Back to CHV submission">
              <ArrowLeft className="size-4" aria-hidden />
              <span className="hidden sm:inline">Back to CHV submission</span>
              <span className="sm:hidden">Back</span>
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            className="h-10 min-h-[44px] px-3"
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
      <Separator className="mt-6" />
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Main dashboard view (data loaded & non-empty)                       */
/* ------------------------------------------------------------------ */

function DashboardView({
  stats,
  onSeed,
  seeding,
}: {
  stats: DashboardStats;
  onSeed: () => void;
  seeding: boolean;
}) {
  const { totals } = stats;

  // KPI hints: small trend hints derivable from the regional byDay series.
  const followupDelta = weeklyDelta(stats.byDay, "needs_followup");
  const escalationDelta = weeklyDelta(stats.byDay, "escalation");

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

  const insights = computeInsights(stats);

  return (
    <div className="space-y-6">
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
      </section>

      {/* Soft prompt if dataset feels thin (defensive — shouldn't fire after auto-seed). */}
      {totals.total > 0 && totals.total < 3 ? (
        <SeedPromptBanner onSeed={onSeed} seeding={seeding} />
      ) : null}

      {/* Insights */}
      <section aria-label="Insight callouts" aria-live="polite">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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
            <CountyBarChart data={stats.byCounty} />
          </ChartCard>

          <ChartCard
            title="Daily trend (14 days)"
            subtitle="Classification volumes per day across all counties"
            icon={<LineChartIcon className="size-4" aria-hidden />}
          >
            <DailyTrendChart data={stats.byDay} />
          </ChartCard>

          <ChartCard
            title="Top aggregate tags"
            subtitle="Most-frequent triaged aggregate tags (top 12)"
            icon={<Tags className="size-4" aria-hidden />}
          >
            <TopTagsChart data={stats.byTag.slice(0, 12)} />
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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
              <CountyTable stats={stats} />
            </CardContent>
          </Card>
        </motion.div>
      </section>
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
