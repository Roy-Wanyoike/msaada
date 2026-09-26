import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { toCaseDTO } from "@/lib/community-report-store";
import { CASE_ASSIGNER_ROLES, NATIONAL_ROLES } from "@/lib/community-report-types";
import { getAssignmentCandidates } from "@/lib/case-assignment";
import { suggestAssignment } from "@/lib/ai/case-ops";

export const dynamic = "force-dynamic";

/**
 * GET /api/response-cases/[id]/suggest-assignment
 *
 * Qwen suggests which eligible CHV (active, same county) should take the
 * case, with a one-line reason. Falls back to a simple rule (same ward, then
 * lightest load) if the model is unavailable. Advisory: the supervisor
 * confirms via POST /api/response-cases/[id]/assign.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionChv();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!CASE_ASSIGNER_ROLES.includes(user.role ?? "chv")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id } = await params;

  const row = await db.responseCase.findUnique({ where: { id }, include: { report: true } });
  if (!row || !row.report) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const national = NATIONAL_ROLES.includes(user.role ?? "");
  if (!national && row.report.county !== user.county) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const rl = checkRateLimit(`assign-suggest:${user.id}`, { capacity: 15, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const candidates = await getAssignmentCandidates(row.report.county);
  if (candidates.length === 0) {
    return NextResponse.json({ error: "NO_ELIGIBLE_CHVS" }, { status: 422 });
  }
  const intake = toCaseDTO(row).aiIntake;
  const suggestion = await suggestAssignment(
    {
      category: row.report.category,
      county: row.report.county,
      ward: row.report.ward,
      landmark: row.report.landmark,
      urgency: intake?.urgency ?? null,
      summary: intake?.summary ?? null,
    },
    candidates
  );

  return NextResponse.json({
    suggestion: suggestion && {
      ...suggestion,
      fullName: candidates.find((c) => c.id === suggestion.chvId)?.fullName ?? suggestion.label,
    },
    candidates: candidates.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      ward: c.ward,
      openCases: c.openCases,
      submissionsLast7d: c.submissionsLast7d,
    })),
  });
}
