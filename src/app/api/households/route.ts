import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { createHousehold, getMyHouseholds } from "@/lib/identity-store";
import { COUNTIES, WARDS, type County } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Roles that operate county-wide (mirrors the ADMIN_ROLES set in the
 * community-reports routes — issue #13/#45). Admins may file a household in
 * any authorized county; every other role is pinned to their own session
 * county. Default-deny: any unlisted role is treated as county-scoped.
 */
const ADMIN_ROLES = new Set([
  "county_admin",
  "moh_admin",
  "system_admin",
]);

function bad(error: string, field?: string, status = 400) {
  return NextResponse.json(field ? { error, field } : { error }, { status });
}

/** GET /api/households — list the CHV's assigned households (ownership-scoped). */
export async function GET() {
  const chv = await getSessionChv();
  if (!chv) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const households = await getMyHouseholds(chv.id);
  return NextResponse.json({ households });
}

/**
 * POST /api/households — create a household assigned to the CHV.
 *
 * Geographic validation (issue #45 — was previously a passthrough, so
 * arbitrary counties like "Atlantis" were accepted with 201):
 *  - county must be one of the authorized COUNTIES (INVALID_COUNTY);
 *  - non-admins may not choose a county at all: the household defaults to
 *    the CHV's own session county, and a DIFFERENT county is rejected with
 *    400 COUNTY_MISMATCH (least privilege — matches the community-reports
 *    county-scoping posture);
 *  - ward, when provided, must belong to the resolved county's WARDS —
 *    non-string/empty ward → INVALID_WARD, wrong ward → WARD_NOT_IN_COUNTY
 *    (same error codes + {error, field} shape as POST /api/triage).
 */
export async function POST(req: Request) {
  const chv = await getSessionChv();
  if (!chv) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { county, ward, label } = (body ?? {}) as {
    county?: unknown;
    ward?: unknown;
    label?: unknown;
  };

  const isAdmin = ADMIN_ROLES.has(chv.role ?? "chv");

  // ---- County: validate + county-pin non-admins ---------------------------
  let countyTyped: County | undefined;
  if (county === undefined || county === null || county === "") {
    // Non-admins: default to the CHV's own county (they operate there).
    // Admins: no county submitted → keep the legacy MISSING_FIELDS contract.
    if (!isAdmin && chv.county) {
      countyTyped = COUNTIES.includes(chv.county as County)
        ? (chv.county as County)
        : undefined;
    }
    if (!countyTyped) {
      return bad("MISSING_FIELDS");
    }
  } else {
    if (typeof county !== "string" || !COUNTIES.includes(county as County)) {
      return bad("INVALID_COUNTY", "county");
    }
    if (!isAdmin && chv.county && county !== chv.county) {
      return bad("COUNTY_MISMATCH", "county");
    }
    countyTyped = county as County;
  }

  // ---- Ward: must belong to the resolved county (triage-route pattern) ----
  let wardTyped: string | undefined;
  if (ward !== undefined && ward !== null && ward !== "") {
    if (typeof ward !== "string" || ward.trim().length === 0) {
      return bad("INVALID_WARD", "ward");
    }
    if (!WARDS[countyTyped].includes(ward)) {
      return bad("WARD_NOT_IN_COUNTY", "ward");
    }
    wardTyped = ward;
  }

  if (!label || typeof label !== "string" || !label.trim()) {
    return bad("MISSING_FIELDS");
  }

  const household = await createHousehold({
    chwId: chv.id,
    county: countyTyped,
    ward: wardTyped,
    label: label.slice(0, 100),
  });
  return NextResponse.json(household, { status: 201 });
}
