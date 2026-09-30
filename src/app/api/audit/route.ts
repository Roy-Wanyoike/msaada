import { NextResponse } from "next/server";
import { getAuditPage } from "@/lib/triage-store";
import { getSessionChv } from "@/lib/auth";
import { canViewAudit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/audit
 *
 * Paginated, filterable audit log (de-identified — truncated CHV labels,
 * never emails; never observation text). For the compliance-officer viewer.
 *
 * Auth contract (issue #54):
 *  - 401 {error:"UNAUTHORIZED"} — no session (or invalid/expired session).
 *  - 403 {error:"FORBIDDEN"} — session role is not an audit viewer
 *    (canViewAudit: auditor, moh_admin, moh_officer, county_admin,
 *    program_admin, system_admin). A plain CHV or cho_supervisor does not
 *    get the compliance trail.
 *  - 200 — the audit page payload (shape unchanged for authorized callers).
 *
 * Query params:
 *  - page: number (default 1)
 *  - pageSize: number (default 25, max 100)
 *  - county: string (filter)
 *  - event: string (filter — triage_classified | crisis_override | fallback_used)
 *  - escalation: "true" to filter to escalations only
 */
export async function GET(req: Request) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewAudit(chv.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = url.searchParams.get("page");
  const pageSize = url.searchParams.get("pageSize");
  const county = url.searchParams.get("county") ?? undefined;
  const event = url.searchParams.get("event") ?? undefined;
  const escalation = url.searchParams.get("escalation");

  // NaN guard: parseInt("abc") === NaN, then Math.max(1, NaN) === NaN, then
  // Prisma's `skip: NaN` throws → unhandled 500. Fall back to the default
  // for any non-finite parse result (empty string, non-numeric, ±Infinity).
  const parsedPage = page ? Number.parseInt(page, 10) : 1;
  const parsedPageSize = pageSize ? Number.parseInt(pageSize, 10) : 25;
  const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const safePageSize =
    Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : 25;

  const result = await getAuditPage({
    page: safePage,
    pageSize: safePageSize,
    county: county || undefined,
    event: event || undefined,
    escalationOnly: escalation === "true",
  });

  return NextResponse.json(result, { status: 200 });
}
