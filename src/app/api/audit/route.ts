import { NextResponse } from "next/server";
import { getAuditPage } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/audit
 *
 * Paginated, filterable audit log (de-identified — truncated CHV labels,
 * never emails; never observation text). For the compliance-officer viewer.
 *
 * Query params:
 *  - page: number (default 1)
 *  - pageSize: number (default 25, max 100)
 *  - county: string (filter)
 *  - event: string (filter — triage_classified | crisis_override | fallback_used)
 *  - escalation: "true" to filter to escalations only
 *
 * TODO (production): require a compliance-officer role (RBAC). Currently open
 * for the demo so judges can inspect the audit trail.
 */
export async function GET(req: Request) {
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
