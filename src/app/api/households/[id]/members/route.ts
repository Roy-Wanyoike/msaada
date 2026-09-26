import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { createMember } from "@/lib/identity-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/households/[id]/members — add a member to the household.
 *
 * Duplicate guard, phase 1 (issue #45): before creating, an exact-match
 * check rejects a member whose normalized displayName (trimmed,
 * case-insensitive), role AND ageBand all equal an existing active member
 * of the SAME household → 409 {error: "DUPLICATE_MEMBER", memberId}.
 * Deliberately conservative: only exact attribute matches 409; near-matches
 * (probabilistic matching + human-confirm flow) stay out of scope.
 */
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
  const displayNameTyped = String(displayName).slice(0, 100);
  const roleTyped = role == null || role === "" ? null : String(role).trim().slice(0, 50) || null;
  const ageBandTyped =
    ageBand == null || ageBand === "" ? null : String(ageBand).trim().slice(0, 20) || null;

  // Exact-match duplicate guard — same household + normalized name + role +
  // ageBand. SQLite (Prisma) has no case-insensitive `mode: "insensitive"`,
  // so the comparison happens here over the household's active roster.
  const roster = await db.householdMember.findMany({
    where: { householdId: id, status: "active" },
    select: { id: true, displayName: true, role: true, ageBand: true },
  });
  const normalized = displayNameTyped.trim().toLowerCase();
  const duplicate = roster.find(
    (m) =>
      m.displayName.trim().toLowerCase() === normalized &&
      (m.role ?? null) === roleTyped &&
      (m.ageBand ?? null) === ageBandTyped
  );
  if (duplicate) {
    return NextResponse.json(
      { error: "DUPLICATE_MEMBER", memberId: duplicate.id },
      { status: 409 }
    );
  }

  const member = await createMember({
    householdId: id,
    displayName: displayNameTyped,
    role: roleTyped ?? undefined,
    ageBand: ageBandTyped ?? undefined,
  });
  return NextResponse.json(member, { status: 201 });
}
