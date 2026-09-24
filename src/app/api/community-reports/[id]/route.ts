import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { getReport } from "@/lib/community-report-store";

// Always dynamic -- auth + per-request DB read.
export const dynamic = "force-dynamic";

/**
 * GET /api/community-reports/[id]
 *
 * AUTH-REQUIRED (session). Returns a single CommunityReportDTO by ID.
 * Used by CHVs/supervisors to inspect a submitted concern. The
 * description field is the PII-scrubbed text (the raw was never persisted).
 *
 * Returns 401 if no session, 404 if the report does not exist.
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
    return NextResponse.json(report);
  } catch (err) {
    console.error("[community-reports/[id]] GET unexpected failure:", err);
    return NextResponse.json(
      { error: "REPORT_FETCH_FAILED" },
      { status: 500 }
    );
  }
}
