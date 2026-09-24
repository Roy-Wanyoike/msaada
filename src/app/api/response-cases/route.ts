import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import {
  getCasesForChv,
  getCasesForSupervisor,
} from "@/lib/community-report-store";
import { CASE_STATUSES } from "@/lib/community-report-types";

export const dynamic = "force-dynamic";

// Roles that supervise CHVs / administer the system. A user in any of these
// roles sees cases via getCasesForSupervisor (cases they assigned OR are
// responsible for). Everyone else (the CHV role) sees only cases assigned to
// them via getCasesForChv. Matches the RBAC intent in invitations/route.ts.
const SUPERVISOR_ROLES = [
  "county_admin",
  "cho_supervisor",
  "moh_admin",
  "system_admin",
];

/**
 * GET /api/response-cases
 *
 * Returns the authenticated user's response cases. The list is ownership- and
 * role-scoped at the data-access boundary:
 *  - A CHV sees only cases assigned to them (RLS-equivalent: assignedChvId = me).
 *  - A supervisor/admin sees cases they assigned (or are responsible for).
 *
 * Query params:
 *  - status: optional filter (must be a value from CASE_STATUSES). If omitted,
 *    all cases are returned (subject to the role scoping above).
 *
 * CR-007: the case list is the CHV's "queue" of assigned work. CR-008 §8:
 * assignment is deterministic (not AI); the supervisor specifies the CHV —
 * this route just returns the already-assigned set.
 */
export async function GET(req: Request) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");

  // Validate the status filter against the authoritative CASE_STATUSES enum.
  // An unknown value would silently return an empty list at the data layer
  // (Prisma treats it as a literal filter) — surfacing it as a 400 makes the
  // contract explicit and helps the frontend catch typos.
  let status: string | undefined;
  if (statusParam) {
    const trimmed = statusParam.trim();
    if (!trimmed) {
      status = undefined;
    } else if (!CASE_STATUSES.includes(trimmed as (typeof CASE_STATUSES)[number])) {
      return NextResponse.json(
        { error: "INVALID_STATUS", field: "status", allowed: CASE_STATUSES },
        { status: 400 }
      );
    } else {
      status = trimmed;
    }
  }

  const isSupervisor = SUPERVISOR_ROLES.includes(chv.role ?? "chv");
  const cases = isSupervisor
    ? await getCasesForSupervisor(chv.id, status)
    : await getCasesForChv(chv.id, status);

  return NextResponse.json({ cases });
}
