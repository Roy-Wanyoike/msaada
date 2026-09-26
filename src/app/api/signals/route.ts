import { NextResponse } from "next/server";
import { getSignals } from "@/lib/signals";
import { getSessionChv } from "@/lib/auth";

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
 * RBAC (county-level) — mirrors /api/dashboard exactly:
 *  - If a CHV session exists AND ?scope=mine is set, signals are computed
 *    for that CHV's county only. This mirrors the Supabase RLS policy
 *    "county official sees only their county's aggregates".
 *  - Otherwise (no session, or ?scope=all) returns all-county signals.
 *    The all-county path is the demo/judge view; production would require
 *    an admin/national role for it (RBAC TODO, same as the dashboard).
 *  - The response includes `scope: { county: string | null, mode: "mine" | "all" }`
 *    so the UI can state which slice the signals were computed over.
 *
 * Query params:
 *  - scope: "mine" | "all" (default "all"; "mine" requires a session).
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

  // Try to read an optional session CHV (for RBAC). Never fails — if no
  // session or scope!=mine, we return the all-county demo view.
  const chv = await getSessionChv();
  const wantMine = scopeParam === "mine" && chv && chv.county;

  let result;
  let scopeCounty: string | null = null;
  if (wantMine && chv?.county) {
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
