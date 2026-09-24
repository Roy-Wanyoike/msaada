import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMembers, createMember } from "@/lib/identity-store";

export const dynamic = "force-dynamic";

/** GET /api/households/[id] — get a household + its members (ownership-scoped). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const chv = await getSessionChv();
  if (!chv) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  const household = await db.household.findFirst({ where: { id, chwId: chv.id } });
  if (!household) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const members = await getMembers(id);
  return NextResponse.json({ household, members });
}
