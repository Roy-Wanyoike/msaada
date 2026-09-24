import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { getMyReferrals } from "@/lib/identity-store";

export const dynamic = "force-dynamic";

/** GET /api/referrals — list the CHV's referrals (ownership-scoped). */
export async function GET(req: Request) {
  const chv = await getSessionChv();
  if (!chv) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const referrals = await getMyReferrals(chv.id, status);
  return NextResponse.json({ referrals });
}
