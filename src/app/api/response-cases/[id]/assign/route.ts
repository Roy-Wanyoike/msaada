import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { assignChvToCase } from "@/lib/community-report-store";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Roles authorized to assign a CHV to a response case. Matches the
// invitation-issuer set: county_admin (sub-county ops), cho_supervisor
// (field-level supervisor), moh_admin / system_admin (system-wide). A CHV
// cannot self-assign — the assignment decision is institutional, not
// individual (CR-008 §8: deterministic + explainable + auditable).
const ASSIGNER_ROLES = [
  "county_admin",
  "cho_supervisor",
  "moh_admin",
  "system_admin",
];

const ASSIGNMENT_RULE_VERSION = "1.0.0";
const ASSIGNMENT_REASON = "manual assignment";

/**
 * POST /api/response-cases/[id]/assign
 *
 * Deterministic CHV assignment (CR-008 §8 — NOT AI). The caller (a supervisor
 * or admin) explicitly specifies which CHV should take the case. There is no
 * auto-selection, no scoring, no model involvement: the assignment is the
 * supervisor's intentional decision, recorded with a stable reason + rule
 * version so it can be audited and explained later.
 *
 * Body: { chvId }
 *
 * Authorship is preserved:
 *  - assignedSupervisorId = the supervisor who made this assignment.
 *  - assignmentReason / assignmentRuleVersion = the explainable rationale.
 *  - assignedAt is updated to "now" (reassignment resets the clock).
 *  - reassignedAt is set if a CHV was already assigned (preserves the
 *    "this case has been reassigned" signal without losing the new
 *    assignment — historical assignments are NOT deleted; the case row
 *    carries the latest assignment, and the audit trail is the source of
 *    truth for prior assignments in production).
 *
 * The target chvId must reference a real, active user with role "chv" (a
 * supervisor cannot assign to another supervisor or to a non-existent user).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supervisor = await getSessionChv();
    if (!supervisor) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (!ASSIGNER_ROLES.includes(supervisor.role ?? "chv")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const { id: caseId } = await params;
    if (!caseId) {
      return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
    }
    const { chvId } = (body ?? {}) as { chvId?: unknown };

    if (typeof chvId !== "string" || !chvId.trim()) {
      return NextResponse.json(
        { error: "INVALID_CHV_ID", field: "chvId" },
        { status: 400 }
      );
    }
    const targetChvId = chvId.trim();

    // Verify the case exists. A 404 here is the right mapping (the supervisor
    // cannot assign to something that doesn't exist) — assignChvToCase would
    // otherwise throw a Prisma P2025 ("record not found") which we'd have to
    // translate anyway. Pre-fetching also lets us decide whether to set
    // reassignedAt.
    const existing = await db.responseCase.findUnique({
      where: { id: caseId },
      select: { id: true, assignedChvId: true, status: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    // Verify the target user exists AND is a CHV (not another supervisor, not
    // a non-existent id). This is the assignment-scope guard: only qualified
    // field CHVs may receive assignments. An inactive/suspended CHV is also
    // rejected (authState must be active).
    const targetChv = await db.chvUser.findUnique({
      where: { id: targetChvId },
      select: { id: true, role: true, authState: true, county: true, ward: true },
    });
    if (!targetChv) {
      return NextResponse.json(
        { error: "CHV_NOT_FOUND", field: "chvId" },
        { status: 404 }
      );
    }
    if (targetChv.role !== "chv") {
      return NextResponse.json(
        { error: "TARGET_NOT_CHV", field: "chvId", targetRole: targetChv.role },
        { status: 400 }
      );
    }
    if (targetChv.authState !== "active") {
      return NextResponse.json(
        { error: "CHV_NOT_ACTIVE", field: "chvId", authState: targetChv.authState },
        { status: 409 }
      );
    }

    // Mark reassignedAt if we're changing the assigned CHV (i.e. there was a
    // previous assignment and it's a different CHV). This preserves the
    // "this case has been reassigned" signal for the audit trail. We do NOT
    // delete the previous assignment history — in production a separate
    // case_assignment_history table would record every assignment; for the
    // MVP the case row carries the latest assignment and reassignedAt is the
    // breadcrumb that a reassignment happened.
    const isReassignment =
      existing.assignedChvId !== null && existing.assignedChvId !== targetChvId;

    // assignChvToCase overwrites the assignment fields. To preserve
    // reassignedAt, we set it ourselves first (the store doesn't currently
    // set reassignedAt — that's a CR-008 §8 concern owned here).
    if (isReassignment) {
      await db.responseCase.update({
        where: { id: caseId },
        data: { reassignedAt: new Date() },
      });
    }

    const updated = await assignChvToCase({
      caseId,
      chvId: targetChvId,
      supervisorId: supervisor.id,
      reason: ASSIGNMENT_REASON,
      ruleVersion: ASSIGNMENT_RULE_VERSION,
    });

    if (!updated) {
      // assignChvToCase returns null only if the case was concurrently deleted
      // between our pre-fetch and the update (P2025 → null in the store). Map
      // to 404 — the case no longer exists.
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json(
      {
        case: updated,
        assignment: {
          chvId: targetChvId,
          supervisorId: supervisor.id,
          reason: ASSIGNMENT_REASON,
          ruleVersion: ASSIGNMENT_RULE_VERSION,
          isReassignment,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    // Last-resort guard — surface unexpected throws as a generic 500 with no
    // detail leak (Prisma connectivity, internal type coercion, etc.).
    console.error("[response-cases assign POST] internal error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
