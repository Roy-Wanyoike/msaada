"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  ClipboardCheck,
  ClipboardList,
  FolderOpen,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * CommunityIntelligenceWidget — CR-015
 *
 * Embeds community-reporting intelligence into the existing county dashboard.
 * Shows management-relevant aggregates that the dashboard's triage-KPI grid
 * does NOT surface (those are CHV-submitted triage observations; this widget
 * is for community-submitted concerns + the response-case dispatch state).
 *
 * Data sources (two list endpoints, by design — the integration agent for
 * CR-011+ exposes the same `/api/community-reports` route the reports admin
 * page uses, scoped by `status`):
 *  - GET /api/community-reports?status=received  → pending triage
 *  - GET /api/community-reports?status=triaged   → ready for assignment
 *
 * The "Open response cases" KPI is derived client-side by summing the
 * denormalized `responseCaseCount` carried on each report DTO (the store's
 * `getReports()` returns this per-report). This avoids a third round-trip
 * and stays within the spec's "two endpoints" constraint. NB: if the list
 * page size < total reports, the case count is an under-count — flagged as a
 * known limitation. For the dashboard widget context (county official
 * scanning totals), this is acceptable; the canonical source for case totals
 * is `getCommunityReportStats()` (CR-014), used by the analytics route.
 *
 * Resilient: if either endpoint is not yet wired up (404/500) or the network
 * fails, the widget renders zeros and a "—" placeholder rather than crashing
 * the whole dashboard. A subsequent dashboard refresh re-tries.
 *
 * Role-aware link: `/cases` for CHVs, `/admin` for county admins (detected
 * via `/api/auth/me`). Defaults to `/cases` for anonymous / unknown roles,
 * since CHV is the sandbox default role.
 *
 * Palette: emerald/teal only (no indigo/blue — per Msaada design guide).
 * Accessibility: the section is a labelled region; the distribution bar is
 * an ARIA `img` with a textual state breakdown.
 */

interface ReportListItem {
  responseCaseCount?: number;
}

interface ReportsListResponse {
  reports?: ReportListItem[];
  total?: number;
}

interface MeResponse {
  chv: { role?: string } | null;
}

type LoadState = "loading" | "ready";

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/** fetch that swallows network/HTTP failures — returns null on any error. */
async function safeFetch(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

export function CommunityIntelligenceWidget() {
  const [pendingTriage, setPendingTriage] = useState<number>(0);
  const [readyForAssignment, setReadyForAssignment] = useState<number>(0);
  const [openCases, setOpenCases] = useState<number>(0);
  const [role, setRole] = useState<"chv" | "county_admin" | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    const [receivedRes, triagedRes, meRes] = await Promise.all([
      safeFetch("/api/community-reports?status=received&limit=100"),
      safeFetch("/api/community-reports?status=triaged&limit=100"),
      safeFetch("/api/auth/me"),
    ]);

    let receivedTotal = 0;
    let receivedCases = 0;
    if (receivedRes) {
      const body = (await receivedRes.json().catch(() => ({}))) as ReportsListResponse;
      receivedTotal = body.total ?? body.reports?.length ?? 0;
      receivedCases = (body.reports ?? []).reduce(
        (sum, r) => sum + (r.responseCaseCount ?? 0),
        0,
      );
    }

    let triagedTotal = 0;
    let triagedCases = 0;
    if (triagedRes) {
      const body = (await triagedRes.json().catch(() => ({}))) as ReportsListResponse;
      triagedTotal = body.total ?? body.reports?.length ?? 0;
      triagedCases = (body.reports ?? []).reduce(
        (sum, r) => sum + (r.responseCaseCount ?? 0),
        0,
      );
    }

    if (meRes) {
      const meBody = (await meRes.json().catch(() => ({}))) as MeResponse;
      if (meBody.chv?.role === "county_admin") {
        setRole("county_admin");
      } else if (meBody.chv?.role === "chv") {
        setRole("chv");
      } else {
        setRole(null);
      }
    }

    setPendingTriage(receivedTotal);
    setReadyForAssignment(triagedTotal);
    // Open response cases — denormalized sum across both list pages.
    // Known limitation: under-counts if total > page size (100 here).
    setOpenCases(receivedCases + triagedCases);
    setState("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const total = pendingTriage + readyForAssignment;
  const pendingPct = pct(pendingTriage, total);
  const readyPct = pct(readyForAssignment, total);
  const isLoading = state === "loading";
  const dash = isLoading ? "—" : null;
  // County admins land on the admin reports console; CHVs (and the default
  // demo/anonymous role) land on the cases dispatch queue.
  const viewHref = role === "county_admin" ? "/admin" : "/cases";
  const viewLabel =
    role === "county_admin" ? "View in admin" : "View reports";

  return (
    <motion.section
      role="region"
      aria-label="Community reporting intelligence"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full"
    >
      <Card className="relative overflow-hidden gap-0 border-teal-200/70 bg-gradient-to-br from-emerald-50/70 via-teal-50/40 to-background px-4 py-4 shadow-sm dark:border-teal-900/60 sm:px-6 sm:py-5">
        {/* Top accent bar — emerald → teal gradient strip */}
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-400 to-teal-600 opacity-70"
          aria-hidden
        />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:justify-between">
          {/* ---- Left: headline KPI + status badges ---- */}
          <div className="flex-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Community intelligence
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span
                    className="text-3xl font-semibold leading-none tabular-nums text-foreground"
                    aria-live="polite"
                  >
                    {dash ?? total}
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">
                    community reports
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Demand from community channels, awaiting or ready for
                  response.
                </p>
              </div>
              <span
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-background/70 text-teal-600 ring-1 ring-border/40 dark:text-teal-300"
                aria-hidden
              >
                <Activity className="size-4" />
              </span>
            </div>

            {/* Status badges — amber = pending triage, teal = ready */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
              >
                <ClipboardList className="size-3" aria-hidden />
                <span className="tabular-nums">{dash ?? pendingTriage}</span>
                pending triage
              </Badge>
              <Badge
                variant="outline"
                className="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300"
              >
                <ClipboardCheck className="size-3" aria-hidden />
                <span className="tabular-nums">{dash ?? readyForAssignment}</span>
                ready for assignment
              </Badge>
            </div>
          </div>

          {/* ---- Right: status distribution bar + open cases tile ---- */}
          <div className="flex flex-col gap-2.5 lg:w-72">
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>Status distribution</span>
                <span className="tabular-nums">{pendingPct + readyPct}%</span>
              </div>
              {/* Stacked progress bar — amber (pending) + teal (ready) */}
              <div
                className="relative flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`Pending triage ${pendingPct}%, ready for assignment ${readyPct}%`}
              >
                <motion.div
                  className="h-full bg-amber-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${pendingPct}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
                <motion.div
                  className="h-full bg-teal-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${readyPct}%` }}
                  transition={{ duration: 0.5, delay: 0.08, ease: "easeOut" }}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span
                    className="size-1.5 rounded-full bg-amber-500"
                    aria-hidden
                  />
                  Pending {pendingPct}%
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="size-1.5 rounded-full bg-teal-500"
                    aria-hidden
                  />
                  Ready {readyPct}%
                </span>
              </div>
            </div>

            {/* Open response cases tile */}
            <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/70 px-2.5 py-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FolderOpen
                  className="size-3.5 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
                Open response cases
              </span>
              <span
                className="text-sm font-bold tabular-nums text-foreground"
                aria-live="polite"
              >
                {dash ?? openCases}
              </span>
            </div>
          </div>
        </div>

        {/* ---- Footer: role-aware "View reports" link ---- */}
        <div className="mt-3 flex items-center justify-end border-t border-border/40 pt-2">
          <Link
            href={viewHref}
            className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 underline-offset-2 transition-colors hover:text-teal-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-1 dark:text-teal-300 dark:hover:text-teal-200"
          >
            {viewLabel}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </Card>
    </motion.section>
  );
}
