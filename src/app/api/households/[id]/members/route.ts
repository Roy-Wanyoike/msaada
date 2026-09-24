import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { createMember } from "@/lib/identity-store";

export const dynamic = "force-dynamic";

/** POST /api/households/[id]/members — add a member to the household. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const chv = await getSessionChv();
  if (!chv) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  // Ownership check
  const household = await db.household.findFirst({ where: { id, chwId: chv.id } });
  if (!household) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const { displayName, role, ageBand } = await req.json().catch(() => ({}));
  if (!displayName) {
    return NextResponse.json({ error: "MISSING_DISPLAY_NAME" }, { status: 400 });
  }
  const member = await createMember({
    householdId: id,
    displayName: String(displayName).slice(0, 100),
    role,
    ageBand,
  });
  return NextResponse.json(member, { status: 201 });
}
