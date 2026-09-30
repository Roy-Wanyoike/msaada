import { NextResponse } from "next/server";
import { getSignals } from "@/lib/signals";
import { getSessionChv } from "@/lib/auth";
import { isCountyOrAbove } from "@/lib/rbac";

// Signals are computed over windows that end "now" → never static.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/signals
 *
 * Deterministic early-warning signals: unusual aggregate changes between the
 * current 7-day window and the previous 7-day window (see src/lib/signals.ts
 * for the thresholds and kinds). Pure threshold math — no AI is involved at
 * any point. Always 200 with `signals: []` on quiet windows.
 *
 * Auth contract (issue #54) — mirrors /api/dashboard exactly:
 *  - 401 {error:"UNAUTHORIZED"} — no session. The all-county signal
 *    surface is never served anonymously.
 *  - 403 {error:"FORBIDDEN"} — the requested scope exceeds the role:
 *    scope=all requires isCountyOrAbove; ?scope=mine with a profile that
 *    has no county also 403s (fail closed, no all-county fallback).
 *  - 200 — payload (shape unchanged for authorized callers): with a
 *    session AND ?scope=mine, signals are computed for the caller's county
 *    only (Supabase RLS mirror: "county official sees only their county's
 *    aggregates"). scope=all (default) returns all-county signals for
 *    county-or-above roles. The response includes
 *    `scope: { county: string | null, mode: "mine" | "all" }` so the UI
 *    can state which slice the signals were computed over.
 *
 * Query params:
 *  - scope: "mine" | "all" (default "all").
 *    Any other value → 400 INVALID_SCOPE. Unknown params are ignored.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");

  // Garbage params → 400 (only `scope` is understood).
  if (scopeParam !== null && scopeParam !== "mine" && scopeParam !== "all") {
    return NextResponse.json(
      {
        error: "INVALID_SCOPE",
        message: 'scope must be "mine" or "all".',
      },
      { status: 400 }
    );
  }

  // Session is REQUIRED (same policy as /api/dashboard).
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const wantMine = scopeParam === "mine";
  if (!wantMine) {
    if (!isCountyOrAbove(chv.role)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
  } else if (!chv.county) {
    // ?scope=mine without a county: nothing to scope to — fail closed.
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let result;
  let scopeCounty: string | null = null;
  if (wantMine && chv.county) {
    result = await getSignals({ county: chv.county });
    scopeCounty = chv.county;
  } else {
    result = await getSignals();
  }

  return NextResponse.json(
    {
      ...result,
      scope: {
        county: scopeCounty,
        mode: scopeCounty ? ("mine" as const) : ("all" as const),
      },
    },
    { status: 200 }
  );
}
