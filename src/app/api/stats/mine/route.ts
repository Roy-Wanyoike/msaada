import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { getMyStats } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/mine
 * Returns the authenticated CHV's personal aggregate stats (ownership-scoped
 * — the RLS `auth.uid() = submitted_by` equivalent). De-identified (computed
 * from their own records only; no other CHV's data is touched).
 *
 * Used by the "My impact" card on the CHV submission page.
 */
export async function GET() {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const stats = await getMyStats(chv.id);
  return NextResponse.json(stats, { status: 200 });
}
