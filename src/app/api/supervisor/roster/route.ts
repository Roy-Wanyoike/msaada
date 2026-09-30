import { NextResponse } from "next/server";
import { getSupervisorOps, getSupervisorRoster } from "@/lib/triage-store";
import { getSessionChv } from "@/lib/auth";
import { isSupervisorOrAbove } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/supervisor/roster
 *
 * Returns a de-identified per-CHV roster (supervisor view). Groups triage
 * records by submitting CHV, returning per-CHV aggregate counts (never the
 * email, never observation text). A supervisor sees activity + load +
 * escalation burden per volunteer.
 *
 * MVP-44 (additive): the response also carries `ops` — the command-center
 * signals (overdue referrals, pending work, data-quality issues) from
 * getSupervisorOps. Existing fields are unchanged; consumers that only know
 * `rows`/`totals` keep working.
 *
 * Auth contract (issue #54):
 *  - 401 {error:"UNAUTHORIZED"} — no session.
 *  - 403 {error:"FORBIDDEN"} — role is below supervisor level
 *    (isSupervisorOrAbove: cho_supervisor + all county/national/admin
 *    roles). A plain CHV never sees peers' workload.
 *  - 200 — roster + ops payload (shape unchanged for authorized callers).
 *
 * Query params:
 *  - county: string (optional filter)
 *  - days: number (default 14, max 90)
 */
export async function GET(req: Request) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSupervisorOrAbove(chv.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url);
  const county = url.searchParams.get("county") ?? undefined;
  const daysParam = url.searchParams.get("days");
  let days = 14;
  if (daysParam) {
    const parsed = Number.parseInt(daysParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      days = Math.min(parsed, 90);
    }
  }
  const [roster, ops] = await Promise.all([
    getSupervisorRoster(county || undefined, days),
    getSupervisorOps(county || undefined),
  ]);
  return NextResponse.json({ ...roster, ops }, { status: 200 });
}
