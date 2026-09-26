import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { getReport } from "@/lib/community-report-store";

// Always dynamic -- auth + per-request DB read.
export const dynamic = "force-dynamic";

/**
 * Roles that operate county-wide (county_admin, moh_admin, system_admin) —
 * may inspect any community report regardless of county. All other roles
 * (chv, cho_supervisor, subcounty_admin, moh_officer, program_admin,
 * auditor, etc.) are restricted to reports filed in their own session
 * county (county-RLS equivalent for single-fetch — issue #13).
 * Default-deny: any unlisted role is treated as county-scoped (least
 * privilege) rather than as an admin. Mirrors the ADMIN_ROLES set in the
 * list route (`src/app/api/community-reports/route.ts`).
 */
const ADMIN_ROLES = new Set([
  "county_admin",
  "moh_admin",
  "system_admin",
]);

/**
 * GET /api/community-reports/[id]
 *
 * AUTH-REQUIRED (session). Returns a single CommunityReportDTO by ID.
 * Used by CHVs/supervisors to inspect a submitted concern. The
 * description field is the PII-scrubbed text (the raw was never
 * persisted); landmark + directions are scrubbed with `scrubNote()`
 * (issue #11); `reporterContact` is persisted raw for operational
 * follow-up and is surfaced here only (NOT in list responses — see
 * `src/app/api/community-reports/route.ts` GET handler).
 *
 * County scoping (issue #13): non-admin roles can only fetch reports
 * filed in their own session county. A cross-county single-fetch
 * returns 403 (`COUNTY_MISMATCH`). The store-level `getReport(id)`
 * returns any row by ID — the scoping MUST happen at this route
 * boundary (mirrors the Postgres-RLS-equivalent promise documented in the
 * README and matches the list-route treatment in `route.ts`).
 *
 * Returns 401 if no session, 400 if id is empty, 404 if the report does
 * not exist, 403 if the report exists but is outside the caller's county
 * scope (non-admin role only).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id || typeof id !== "string" || id.trim().length === 0) {
    return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  }

  try {
    const report = await getReport(id.trim());
    if (!report) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    // County scoping (issue #13): non-admin roles can only read reports
    // filed in their own session county. Admins (county_admin,
    // moh_admin, system_admin) may inspect any report. If a non-admin
    // session has no county set, treat as no access (least privilege —
    // the report's county cannot equal `null`).
    const isAdmin = ADMIN_ROLES.has(chv.role ?? "chv");
    if (!isAdmin) {
      if (!chv.county || report.county !== chv.county) {
        return NextResponse.json(
          { error: "COUNTY_MISMATCH" },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(report);
  } catch (err) {
    console.error("[community-reports/[id]] GET unexpected failure:", err);
    return NextResponse.json(
      { error: "REPORT_FETCH_FAILED" },
      { status: 500 }
    );
  }
}
