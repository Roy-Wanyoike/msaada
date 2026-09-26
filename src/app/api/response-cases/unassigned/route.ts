import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { toCaseDTO } from "@/lib/community-report-store";
import { CASE_ASSIGNER_ROLES, NATIONAL_ROLES } from "@/lib/community-report-types";
import { getUnassignedCases } from "@/lib/case-assignment";

export const dynamic = "force-dynamic";

/**
 * GET /api/response-cases/unassigned — cases waiting for a CHV.
 * Supervisor/admin roles only; scoped to the caller's county unless they
 * hold a national role.
 */
export async function GET() {
  const user = await getSessionChv();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!CASE_ASSIGNER_ROLES.includes(user.role ?? "chv")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const county = NATIONAL_ROLES.includes(user.role ?? "") ? null : user.county;
  const rows = await getUnassignedCases(county);
  return NextResponse.json({ cases: rows.map(toCaseDTO) });
}
