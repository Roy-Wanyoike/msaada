import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { getMyRecords } from "@/lib/triage-store";

/**
 * GET /api/records/mine
 * Returns the authenticated CHV's own recent triage records (ownership-scoped
 * — the RLS `auth.uid() = submitted_by` equivalent). Other CHVs' records are
 * never exposed. The CHV already saw their full structured output at
 * submission time, so returning their own observed_indicators here is safe.
 *
 * Query params:
 *  - limit: number (default 20, max 50)
 */
export async function GET(req: Request) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  let limit = 20;
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 50);
    }
  }

  const records = await getMyRecords(chv.id, limit);
  return NextResponse.json({ records });
}
