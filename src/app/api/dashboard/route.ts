import { NextResponse } from "next/server";
import {
  getDashboardStats,
  getDashboardStatsForCounty,
  getFollowUpStats,
  getRecentAudit,
} from "@/lib/triage-store";
import { getSessionChv } from "@/lib/auth";
import { isCountyOrAbove } from "@/lib/rbac";

// Aggregate stats change with each insert → never static.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/dashboard
 *
 * Returns aggregate-only stats (byCounty, byDay, byTag, totals) plus a
 * recent-activity audit strip (de-identified actor labels).
 *
 * Auth contract (issue #54):
 *  - 401 {error:"UNAUTHORIZED"} — no session at all. The dashboard is no
 *    longer the anonymous demo view; unauthenticated callers are pointed at
 *    sign-in.
 *  - 403 {error:"FORBIDDEN"} — the requested scope exceeds the caller's
 *    role: scope=all requires isCountyOrAbove (county_admin,
 *    subcounty_admin, moh_admin, moh_officer, program_admin, system_admin);
 *    ?scope=mine with a profile that has no county also 403s (there is no
 *    county slice to compute, and the all-county fallback would leak
 *    cross-county aggregates to a field role).
 *  - 200 — stats payload (shape unchanged for authorized callers):
 *    scope=mine → any authenticated profile with a county gets
 *    county-scoped stats (byCounty has at most one row; byDay/byTag are
 *    county-filtered). This mirrors the Supabase RLS policy "county
 *    official sees only their county's aggregates".
 *    scope=all (default) → all-county aggregates for county-or-above roles.
 *    The response includes `scope: { county: string|null, mode: "mine"|"all" }`
 *    so the UI can render a clear banner.
 *
 * Query params:
 *  - days: number (default 14, max 90) — time-range filter.
 *  - scope: "mine" | "all" (default "all").
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

  // Session is REQUIRED. Any cookie/session failure is a hard 401 — the
  // all-county aggregate surface is never served anonymously.
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const wantMine = scopeParam === "mine";

  if (!wantMine) {
    // scope=all (explicit or default): all-county aggregates demand
    // county-level (or national) oversight. Field roles (chv,
    // cho_supervisor, auditor) stay on their own county slice.
    if (!isCountyOrAbove(chv.role)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
  } else if (!chv.county) {
    // ?scope=mine without a county on the profile: nothing to scope to.
    // Fail closed rather than falling back to all-county data.
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let stats;
  let scopeCounty: string | null = null;
  if (wantMine && chv.county) {
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
