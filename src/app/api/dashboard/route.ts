import { NextResponse } from "next/server";
import {
  getDashboardStats,
  getDashboardStatsForCounty,
  getFollowUpStats,
  getRecentAudit,
} from "@/lib/triage-store";
import { getSessionChv } from "@/lib/auth";

// Aggregate stats change with each insert → never static.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/dashboard
 *
 * Returns aggregate-only stats (byCounty, byDay, byTag, totals) plus a
 * recent-activity audit strip (de-identified actor labels).
 *
 * RBAC (county-level):
 *  - If a CHV session exists AND ?scope=mine is set, the response is scoped
 *    to that CHV's county only (byCounty has at most one row; byDay/byTag are
 *    county-filtered). This mirrors the Supabase RLS policy "county official
 *    sees only their county's aggregates".
 *  - Otherwise (no session, or ?scope=all) returns all-county aggregates.
 *    The all-county path is the demo/judge view; production would require
 *    an admin/national role for it.
 *  - The response includes `scope: { county: string | null, mode: "mine" | "all" }`
 *    so the UI can render a clear banner.
 *
 * Query params:
 *  - days: number (default 14, max 90) — time-range filter.
 *  - scope: "mine" | "all" (default "all"; "mine" requires a session).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  let days = 14;
  if (daysParam) {
    const parsed = Number.parseInt(daysParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      days = Math.min(parsed, 90);
    }
  }
  const scopeParam = url.searchParams.get("scope") as "mine" | "all" | null;

  // Try to read an optional session CHV (for RBAC). Never fails — if no
  // session or scope!=mine, we return the all-county demo view.
  const chv = await getSessionChv();
  const wantMine = scopeParam === "mine" && chv && chv.county;

  let stats;
  let scopeCounty: string | null = null;
  if (wantMine && chv?.county) {
    stats = await getDashboardStatsForCounty(chv.county, days);
    scopeCounty = chv.county;
  } else {
    stats = await getDashboardStats(days);
  }

  // County-scope the audit strip too — on the `?scope=mine` RBAC path a
  // county official should only see audit entries from their own county.
  // Mirrors the Supabase RLS policy that backs the dashboard view.
  const audit = await getRecentAudit(8, scopeCounty ?? undefined);
  const followUpStats = await getFollowUpStats({
    county: scopeCounty ?? undefined,
    days,
  });

  return NextResponse.json(
    {
      ...stats,
      audit,
      followUpStats,
      scope: {
        county: scopeCounty,
        mode: scopeCounty ? ("mine" as const) : ("all" as const),
      },
    },
    { status: 200 }
  );
}
