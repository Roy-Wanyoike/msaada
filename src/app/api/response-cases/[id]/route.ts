import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import {
  acceptCaseAssignment,
  toCaseDTO,
  updateCaseStatus,
} from "@/lib/community-report-store";
import { db } from "@/lib/db";
import { scrubPII } from "@/lib/pii-scrub";
import type { ResponseCaseDTO } from "@/lib/community-report-types";

export const dynamic = "force-dynamic";

const MAX_RESOLUTION_NOTE_LEN = 500;
const MAX_ENCOUNTER_ID_LEN = 64;

// Roles that can VIEW any single case (read-only). The PATCH lifecycle below
// is intentionally restricted to the assigned CHV — supervisors assign, they
// do not advance the case on the CHV's behalf. This separation matches the
// CR-007 lifecycle (CHV owns the post-assignment transitions) and CR-008 §8
// (supervisor owns only the assignment decision).
const SUPERVISOR_ROLES = [
  "county_admin",
  "cho_supervisor",
  "moh_admin",
  "system_admin",
];

// Once a case reaches a terminal state, further lifecycle transitions are
// rejected (409). This is the minimal state-machine guard — it does not
// enforce the full transition table (e.g. accepted→response_started) because
// the data layer's updateCaseStatus doesn't currently check it either, but
// it prevents the obvious footgun of re-opening a resolved case.
const TERMINAL_STATUSES = new Set([
  "resolved",
  "unable_to_reach",
  "cancelled",
  "duplicate",
]);

// Maps the PATCH `action` to the case status it transitions to. `accept` is
// handled separately because it goes through acceptCaseAssignment (which also
// sets acceptedAt and enforces status==="assigned" at the data layer).
type PatchAction = "accept" | "start" | "attend" | "resolve" | "unable_to_reach";
const ACTION_TO_STATUS: Record<Exclude<PatchAction, "accept">, string> = {
  start: "response_started",
  attend: "attended",
  resolve: "resolved",
  unable_to_reach: "unable_to_reach",
};

/**
 * GET /api/response-cases/[id]
 *
 * Returns a single response case by ID. Read access:
 *  - The assigned CHV (assignedChvId === chv.id).
 *  - Any supervisor/admin (they oversee all cases within their scope).
 *
 * Ownership / scoping is enforced here — the data-access layer's list
 * functions are already scoped, but the single-fetch path needs its own
 * check (there is no getCase(id) helper in the store, so we fetch directly
 * and reconstruct the DTO inline to match the list endpoint's shape).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  }

  const row = await db.responseCase.findUnique({
    where: { id },
    include: { report: true },
  });
  if (!row) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const isSupervisor = SUPERVISOR_ROLES.includes(chv.role ?? "chv");
  const isAssignedChv = row.assignedChvId === chv.id;
  // A CHV may view a case only if they are the assignee. A supervisor/admin
  // may view any case. An unassigned case (assignedChvId === null) is only
  // visible to supervisors — a CHV cannot peek at unassigned work.
  if (!isSupervisor && !isAssignedChv) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  return NextResponse.json(toCaseDTO(row));
}

/**
 * PATCH /api/response-cases/[id]
 *
 * Advance the case lifecycle. Body: { action, resolutionNote?, encounterId? }
 *
 * Actions (CR-007):
 *  - accept          CHV accepts the assignment (assigned → accepted)
 *  - start           CHV begins the response (accepted → response_started)
 *  - attend          CHV attended (may carry encounterId, CR-010 link)
 *  - resolve         CHV resolved the case (→ resolved, sets resolvedAt)
 *  - unable_to_reach CHV could not reach the subject (→ unable_to_reach)
 *
 * Ownership: ONLY the assigned CHV may advance the lifecycle. A supervisor
 * who needs to change the case state must reassign or escalate — they do not
 * act on the CHV's behalf (separation of duties, CR-008 §8). A CHV acting on
 * a case they don't own gets 403.
 *
 * State: transitions FROM a terminal state are rejected with 409.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const chv = await getSessionChv();
    if (!chv) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
    }
    const { action, resolutionNote, encounterId } = (body ?? {}) as {
      action?: unknown;
      resolutionNote?: unknown;
      encounterId?: unknown;
    };

    if (action !== "accept" && !(action in ACTION_TO_STATUS)) {
      return NextResponse.json(
        {
          error: "INVALID_ACTION",
          field: "action",
          allowed: ["accept", "start", "attend", "resolve", "unable_to_reach"],
        },
        { status: 400 }
      );
    }

    // Validate + scrub the resolutionNote (defense-in-depth — a CHV may type a
    // household member's name into the free-text note; the store layer does
    // NOT scrub, so we do it here, matching followups/[id]/route.ts).
    let note: string | undefined;
    if (resolutionNote !== undefined && resolutionNote !== null) {
      if (typeof resolutionNote !== "string") {
        return NextResponse.json(
          { error: "INVALID_NOTE", field: "resolutionNote" },
          { status: 400 }
        );
      }
      const trimmed = resolutionNote.trim();
      if (trimmed) {
        const capped = trimmed.slice(0, MAX_RESOLUTION_NOTE_LEN);
        note = scrubPII(capped).redacted;
      }
    }

    // Validate the encounterId (optional, only meaningful for `attend`).
    // A non-string or absurdly long value is rejected; the actual existence
    // of the encounter is NOT checked here (CR-010's encounter creation is a
    // separate flow — the CHV may pass an encounter they just created).
    let encounter: string | undefined;
    if (encounterId !== undefined && encounterId !== null) {
      if (typeof encounterId !== "string") {
        return NextResponse.json(
          { error: "INVALID_ENCOUNTER_ID", field: "encounterId" },
          { status: 400 }
        );
      }
      const trimmed = encounterId.trim();
      if (trimmed) {
        if (trimmed.length > MAX_ENCOUNTER_ID_LEN) {
          return NextResponse.json(
            { error: "INVALID_ENCOUNTER_ID", field: "encounterId" },
            { status: 400 }
          );
        }
        encounter = trimmed;
      }
    }

    // `attend` may carry an encounterId; other actions should not. If a note
    // or encounterId is supplied on an action that doesn't use it, we silently
    // drop it (the store only applies optional fields where relevant).
    if (action === "attend" && encounter) {
      // OK — pass through.
    } else if (encounter && action !== "attend") {
      // Tolerated — drop it. (No 400 to keep the client contract forgiving.)
      encounter = undefined;
    }

    // Pre-fetch to split the conflated null-return cases from the store:
    // not-found (404), not-owned (403), terminal-state (409), and — for
    // accept — wrong-source-state (409). Without this pre-check the route
    // has no way to distinguish them.
    const existing = await db.responseCase.findUnique({
      where: { id },
      select: {
        id: true,
        assignedChvId: true,
        status: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    // Ownership: only the assigned CHV can advance the lifecycle.
    if (existing.assignedChvId !== chv.id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    // State guard: terminal cases cannot be re-advanced.
    if (TERMINAL_STATUSES.has(existing.status)) {
      return NextResponse.json(
        { error: "CASE_ALREADY_TERMINATED", status: existing.status },
        { status: 409 }
      );
    }

    // `accept` requires the case to be in `assigned` state — acceptCaseAssignment
    // would otherwise return null (which we'd mis-map). Pre-check gives a
    // clean 409 with a useful message.
    if (action === "accept" && existing.status !== "assigned") {
      return NextResponse.json(
        { error: "NOT_ASSIGNABLE_STATE", status: existing.status },
        { status: 409 }
      );
    }

    let updated: ResponseCaseDTO | null;
    if (action === "accept") {
      updated = await acceptCaseAssignment(id, chv.id);
    } else {
      const targetStatus = ACTION_TO_STATUS[action as Exclude<PatchAction, "accept">];
      updated = await updateCaseStatus({
        caseId: id,
        chvId: chv.id,
        status: targetStatus,
        resolutionNote: note,
        encounterId: encounter,
      });
    }

    if (!updated) {
      // TOCTOU race: the case transitioned between our pre-check and the
      // store update (e.g. a concurrent request resolved it, or the assignment
      // was revoked). 409 is the safe mapping.
      return NextResponse.json(
        { error: "STATE_CONFLICT" },
        { status: 409 }
      );
    }
    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    // Last-resort guard — any unexpected throw (Prisma connectivity, internal
    // type coercion, etc.) surfaces as a generic 500 with no detail leak.
    console.error("[response-cases PATCH] internal error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
