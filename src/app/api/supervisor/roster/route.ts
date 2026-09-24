import { NextResponse } from "next/server";
import { getSupervisorRoster } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/supervisor/roster
 *
 * Returns a de-identified per-CHV roster (supervisor view). Groups triage
 * records by submitting CHV, returning per-CHV aggregate counts (never the
 * email, never observation text). A supervisor sees activity + load +
 * escalation burden per volunteer.
 *
 * Query params:
 *  - county: string (optional filter)
 *  - days: number (default 14, max 90)
 *
 * TODO (production): require a supervisor RBAC role. Currently open for demo.
 */
export async function GET(req: Request) {
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
  const roster = await getSupervisorRoster(county || undefined, days);
  return NextResponse.json(roster, { status: 200 });
}
