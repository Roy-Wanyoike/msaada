import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { scrubPII, scrubNote } from "@/lib/pii-scrub";
import { checkRateLimit } from "@/lib/rate-limit";
import { createReport, getReports } from "@/lib/community-report-store";
import { writeCommunityReportAudit } from "@/lib/community-report-audit";
import { REPORT_CATEGORIES } from "@/lib/community-report-types";
import { COUNTIES, WARDS, type County } from "@/lib/types";

// Always dynamic -- rate-limit / auth / per-request DB writes.
export const dynamic = "force-dynamic";

/**
 * Roles that operate county-wide (county_admin, moh_admin, system_admin) —
 * may inspect community reports filed in ANY county. All other roles (chv,
 * cho_supervisor, subcounty_admin, moh_officer, program_admin, auditor, etc.)
 * are scoped to their own session county (county-RLS equivalent — issue #13).
 * Default-deny: any unlisted role is treated as county-scoped (least
 * privilege) rather than as an admin.
 */
const ADMIN_ROLES = new Set([
  "county_admin",
  "moh_admin",
  "system_admin",
]);

function bad(error: string, field?: string, status = 400) {
  return NextResponse.json(field ? { error, field } : { error }, { status });
}

/**
 * Resolve a best-effort client IP for rate-limiting. Behind the sandbox
 * Caddy gateway the original client IP is in `x-forwarded-for` (first entry).
 * Falls back to "unknown" so the rate-limit bucket is still deterministic.
 */
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

interface CommunityReportPostBody {
  description?: unknown;
  category?: unknown;
  county?: unknown;
  ward?: unknown;
  landmark?: unknown;
  directions?: unknown;
  reporterName?: unknown;
  reporterContact?: unknown;
  idempotencyKey?: unknown;
}

/**
 * POST /api/community-reports
 *
 * PUBLIC endpoint -- community members can submit a concern WITHOUT a CHV
 * session (CR-003). Reporter ≠ Reported Subject (the person submitting may
 * not be the person who needs help). The raw concern text is PII-scrubbed
 * BEFORE persistence (de-identification invariant maintained -- the scrubbed
 * text IS the "raw fact").
 *
 * Body: { description, category?, county, ward?, landmark?, directions?,
 *         reporterName?, reporterContact?, idempotencyKey? }
 * Returns: CommunityReportDTO (201) or error (400 / 429 / 500).
 */
export async function POST(req: Request) {
  // Rate-limit per IP (defense layer -- 5 reports / 60s). Public endpoint
  // so the bucket key is IP-only (no session identifier available).
  const ip = clientIp(req);
  const rl = checkRateLimit(`community-report:${ip}`, {
    capacity: 5,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter: Math.ceil(rl.retryAfterMs / 1000) },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("INVALID_JSON");
  }
  if (!body || typeof body !== "object") {
    return bad("INVALID_BODY");
  }
  const {
    description,
    category,
    county,
    ward,
    landmark,
    directions,
    reporterName,
    reporterContact,
    idempotencyKey,
  } = body as CommunityReportPostBody;

  // Validate description (10-5000 chars, non-empty after trim).
  if (typeof description !== "string" || description.trim().length < 10) {
    return bad("MISSING_OR_TOO_SHORT", "description");
  }
  if (description.length > 5000) {
    return bad("DESCRIPTION_TOO_LONG", "description");
  }

  // Validate county (must be in our authorized COUNTIES list).
  if (typeof county !== "string" || !COUNTIES.includes(county as County)) {
    return bad("INVALID_COUNTY", "county");
  }
  const countyTyped = county as County;

  // Validate ward (optional, but if present must belong to the county).
  let wardTyped: string | undefined;
  if (ward !== undefined && ward !== null && ward !== "") {
    if (typeof ward !== "string") {
      return bad("INVALID_WARD", "ward");
    }
    if (!WARDS[countyTyped].includes(ward)) {
      return bad("WARD_NOT_IN_COUNTY", "ward");
    }
    wardTyped = ward;
  }

  // Validate category (optional, defaults to "mental_health").
  let categoryTyped: string | undefined;
  if (category !== undefined && category !== null && category !== "") {
    if (
      typeof category !== "string" ||
      !REPORT_CATEGORIES.includes(
        category as (typeof REPORT_CATEGORIES)[number]
      )
    ) {
      return bad("INVALID_CATEGORY", "category");
    }
    categoryTyped = category;
  }

  // Optional free-text fields (landmark, directions, reporter name/contact).
  // PII scrubbing (issue #11): landmark + directions are run through
  // `scrubNote()` — the lighter scrubber that skips 7-9 digit ID redaction,
  // since these operational-address fields may legitimately contain plot /
  // house numbers that are NOT national IDs (e.g. "Plot 12, near Mama
  // Wanjiru's shop, call 0712 345 678" → "Plot 12, near mama [NAME]'s shop,
  // call [PHONE]"). `reporterName` is a personal name by definition and is
  // run through the full `scrubPII()` pass (catches kinship-prefixed names,
  // phones, emails, plates, M-Pesa codes, plot numbers, school names).
  // `reporterContact` is persisted raw — the operational follow-up use
  // case (assigned CHV needs to phone the reporter) is legitimate, but
  // encryption-at-rest is P2 hardening per the security review. To close
  // the leak in MVP scope, `reporterContact` is STRIPPED from LIST
  // responses (GET handler below) so it is only visible on the
  // single-fetch endpoint to an authenticated CHV/supervisor.
  const landmarkTyped =
    typeof landmark === "string" && landmark.trim().length > 0
      ? scrubNote(landmark.trim().slice(0, 500))
      : undefined;
  const directionsTyped =
    typeof directions === "string" && directions.trim().length > 0
      ? scrubNote(directions.trim().slice(0, 1000))
      : undefined;
  const reporterNameTyped =
    typeof reporterName === "string" && reporterName.trim().length > 0
      ? scrubPII(reporterName.trim().slice(0, 200)).redacted
      : undefined;
  const reporterContactTyped =
    typeof reporterContact === "string" && reporterContact.trim().length > 0
      ? reporterContact.trim().slice(0, 200)
      : undefined;
  const idempotencyKeyTyped =
    typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0
      ? idempotencyKey.trim().slice(0, 200)
      : undefined;

  try {
    // PII-scrub the description BEFORE persistence (defense layer 2 + the
    // never-persist-raw-PII invariant from the triage flow). The scrubbed
    // text IS the persisted "raw fact" -- the de-identification is done at
    // the data-access boundary, not at the read boundary.
    const { redacted: scrubbedDescription } = scrubPII(description.trim());

    const report = await createReport({
      description: scrubbedDescription,
      category: categoryTyped,
      county: countyTyped,
      ward: wardTyped,
      landmark: landmarkTyped,
      directions: directionsTyped,
      reporterName: reporterNameTyped,
      reporterContact: reporterContactTyped,
      idempotencyKey: idempotencyKeyTyped,
      // channel defaults to "web" in the store; reporterType defaults to
      // "self" -- the public web form does not distinguish assisted reports.
    });

    // De-identified log line -- the report code + county + status (no PII).
    console.log(
      `[community-reports] created code=${report.reportCode} county=${
        report.county
      } ward=${report.ward ?? "-"} category=${report.category} status=${
        report.status
      } ip=${ip.slice(0, 8)}`
    );

    // Audit the report creation (CR-014 — de-identified, non-fatal).
    await writeCommunityReportAudit({
      actorId: "public",
      event: "community_report_created",
      county: report.county,
      ward: report.ward,
      classification: report.policyWorkflowClass,
      escalation: report.policyWorkflowClass === "crisis_override",
      policyVersion: report.policyVersion,
    }).catch(() => {});

    return NextResponse.json(report, { status: 201 });
  } catch (err) {
    // Idempotency conflict (unique constraint) -- if the store did not catch
    // it, surface a 409 instead of leaking the Prisma error.
    if (err instanceof Error && /idempotencyKey/i.test(err.message)) {
      return NextResponse.json(
        { error: "IDEMPOTENCY_CONFLICT" },
        { status: 409 }
      );
    }
    console.error("[community-reports] unexpected failure:", err);
    return NextResponse.json(
      {
        error: "REPORT_CREATE_FAILED",
        detail:
          "An unexpected error occurred while storing the report. The report was not saved.",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/community-reports
 *
 * AUTH-REQUIRED (session). For CHVs/supervisors to see submitted reports.
 * Supports filtering by ?status=&county=&category=. Returns the latest 50
 * by default. De-identification: only the PII-scrubbed description is
 * returned (the raw was never persisted).
 *
 * County scoping (issue #13): non-admin roles (chv, cho_supervisor,
 * subcounty_admin, plus any unlisted role by least-privilege default) are
 * restricted to reports filed in their OWN session county — the query-string
 * `county` param is IGNORED for these roles so a CHV in Kilifi cannot ask
 * for Nairobi data. Admin roles (county_admin, moh_admin, system_admin) see
 * all counties and may use the query-string `county` filter.
 *
 * `reporterContact` is STRIPPED from the list response (issue #11) — it is
 * only surfaced on the single-fetch endpoint to the assigned CHV/supervisor.
 */
export async function GET(req: Request) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // County scoping (issue #13). Resolve the session's role + county BEFORE
  // reading the query string so the role decision is authoritative.
  const isAdmin = ADMIN_ROLES.has(chv.role ?? "chv");
  const sessionCounty = chv.county ?? undefined;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const countyParam = url.searchParams.get("county") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const limitParam = url.searchParams.get("limit") ?? undefined;
  const offsetParam = url.searchParams.get("offset") ?? undefined;

  // Validate filter values (ignore garbage rather than 400ing -- this is a
  // read endpoint and the supervisor dashboard may send stale filters).
  const statusTyped =
    status && typeof status === "string" ? status.slice(0, 50) : undefined;
  // For non-admins: FORCE the session county (overrides any query-string
  // value so cross-county reads are impossible). If the session has no
  // county set, the user simply sees no reports (least privilege).
  // For admins: respect the query-string county filter (validated against
  // COUNTIES); absent / invalid filter = all counties.
  const countyTyped: string | undefined = !isAdmin
    ? sessionCounty
    : countyParam && COUNTIES.includes(countyParam as County)
      ? (countyParam as County)
      : undefined;
  const categoryTyped =
    category &&
    REPORT_CATEGORIES.includes(category as (typeof REPORT_CATEGORIES)[number])
      ? category
      : undefined;
  const limit =
    limitParam && /^\d+$/.test(limitParam)
      ? Math.min(parseInt(limitParam, 10), 200)
      : 50;
  const offset =
    offsetParam && /^\d+$/.test(offsetParam)
      ? Math.max(parseInt(offsetParam, 10), 0)
      : 0;

  try {
    const { reports, total } = await getReports({
      status: statusTyped,
      county: countyTyped,
      category: categoryTyped,
      limit,
      offset,
    });
    // Strip `reporterContact` from LIST responses (issue #11). The contact
    // is persisted for operational follow-up but is only surfaced on the
    // single-fetch endpoint to an authenticated CHV/supervisor — never in
    // a bulk list response (which a CHV of any county could otherwise page
    // through if the county scoping above were ever bypassed).
    const reportsWithoutContact = reports.map(
      ({ reporterContact: _stripped, ...rest }) => rest
    );
    return NextResponse.json({ reports: reportsWithoutContact, total });
  } catch (err) {
    console.error("[community-reports] GET unexpected failure:", err);
    return NextResponse.json(
      { error: "REPORTS_FETCH_FAILED" },
      { status: 500 }
    );
  }
}
