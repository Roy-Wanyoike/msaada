import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { getMyFollowUps, type FollowUpStatus } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/followups
 * Returns the authenticated CHV's follow-ups (ownership-scoped). Default:
 * pending only. ?status=all returns all (incl. done/missed history).
 *
 * Query params:
 *  - status: "pending" (default) | "done" | "missed" | "all"
 *  - limit: number (default 50, max 100)
 */
export async function GET(req: Request) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") as FollowUpStatus | "all" | null;
  const limitParam = url.searchParams.get("limit");
  const status = statusParam ?? "pending";
  let limit = 50;
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 100);
  }
  const followUps = await getMyFollowUps(chv.id, { status, limit });
  return NextResponse.json({ followUps });
}
