import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { createEncounter, getMyEncounters } from "@/lib/identity-store";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/encounters — list the CHV's encounters (ownership-scoped). */
export async function GET() {
  const chv = await getSessionChv();
  if (!chv) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const encounters = await getMyEncounters(chv.id);
  return NextResponse.json({ encounters });
}

/** POST /api/encounters — start a new encounter (identity chain §6, §15). */
export async function POST(req: Request) {
  const chv = await getSessionChv();
  if (!chv) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { householdId, memberId, captureMethod, connectivity } = await req.json().catch(() => ({}));
  if (!householdId || !memberId) {
    return NextResponse.json({ error: "MISSING_HOUSEHOLD_OR_MEMBER" }, { status: 400 });
  }
  // Ownership check — the CHV must own the household + the member must belong to it.
  const household = await db.household.findFirst({ where: { id: householdId, chwId: chv.id } });
  if (!household) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const member = await db.householdMember.findFirst({ where: { id: memberId, householdId } });
  if (!member) return NextResponse.json({ error: "MEMBER_NOT_IN_HOUSEHOLD" }, { status: 400 });
  const encounter = await createEncounter({
    householdId,
    memberId,
    chwId: chv.id,
    captureMethod,
    connectivity,
  });
  return NextResponse.json(encounter, { status: 201 });
}
