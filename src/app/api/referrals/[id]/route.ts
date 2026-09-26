import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { getReferralById } from "@/lib/identity-store";
import { REFERRAL_STATES } from "@/lib/identity-types";
import { db } from "@/lib/db";
import { writeAuditEntry } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/referrals/[id] — advance the referral through its 8-state
 * lifecycle (§13): "Referral Created" ≠ "Help Received", so every transition
 * is tracked (and audited) until the referral reaches a terminal state.
 *
 * Allowed transitions (the state machine — anything else is a 409):
 *   created      → sent
 *   sent         → acknowledged | declined | cancelled
 *   acknowledged → in_progress | declined | cancelled
 *   in_progress  → completed | declined | cancelled | expired
 *   completed / declined / cancelled / expired → terminal (no exits)
 *
 * Body: { status, note? }
 *  - status: one of REFERRAL_STATES (the target state).
 *  - note:   optional free-text context. Accepted for API completeness and
 *            validated/capped, but NEVER persisted — the referral model has
 *            no note column and the audit trail must stay text-free (the
 *            same de-identification invariant as triage observations).
 *
 * RBAC: the CHV who owns the encounter (referral.createdById — the user who
 * created the referral from their encounter — or encounter.chwId) OR any
 * county_admin. Everyone else gets 403 FORBIDDEN.
 *
 * Side effects on success:
 *  - acknowledged → stamps acknowledgedAt (first time only) + acknowledgedBy
 *  - completed    → stamps completedAt
 *  - every transition writes an AuditLog row (event `referral_<to>`, e.g.
 *    referral_sent) via the same writeAuditEntry helper the triage flow uses.
 */

/** Forward transition table — keys are the current status. */
const REFERRAL_TRANSITIONS: Record<string, readonly string[]> = {
  created: ["sent"],
  sent: ["acknowledged", "declined", "cancelled"],
  acknowledged: ["in_progress", "declined", "cancelled"],
  in_progress: ["completed", "declined", "cancelled", "expired"],
  completed: [],
  declined: [],
  cancelled: [],
  expired: [],
};

const MAX_NOTE_LEN = 500;

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
    const { status, note } = (body ?? {}) as { status?: unknown; note?: unknown };

    // ---- Validation (400) ----
    if (typeof status !== "string" || !(REFERRAL_STATES as readonly string[]).includes(status)) {
      return NextResponse.json(
        {
          error: "INVALID_STATUS",
          field: "status",
          allowed: REFERRAL_STATES,
        },
        { status: 400 }
      );
    }
    if (note !== undefined && note !== null) {
      if (typeof note !== "string") {
        return NextResponse.json(
          { error: "INVALID_NOTE", field: "note" },
          { status: 400 }
        );
      }
      if (note.trim().length > MAX_NOTE_LEN) {
        return NextResponse.json(
          { error: "NOTE_TOO_LONG", field: "note", max: MAX_NOTE_LEN },
          { status: 400 }
        );
      }
    }

    // ---- Referral + encounter ownership context ----
    const referral = await db.referral.findUnique({
      where: { id },
      include: {
        encounter: {
          include: { household: { select: { county: true, ward: true } } },
        },
      },
    });
    if (!referral) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    // ---- RBAC (403): encounter owner (creator or the encounter's CHW) or county admin ----
    const isCreator = referral.createdById === chv.id;
    const isEncounterChw = referral.encounter.chwId === chv.id;
    const isCountyAdmin = chv.role === "county_admin";
    if (!isCreator && !isEncounterChw && !isCountyAdmin) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // ---- State machine (409) ----
    const allowedTo = REFERRAL_TRANSITIONS[referral.status] ?? [];
    if (!allowedTo.includes(status)) {
      return NextResponse.json(
        { error: "INVALID_TRANSITION", from: referral.status, to: allowedTo },
        { status: 409 }
      );
    }

    // ---- Timestamp stamps (first-time only) ----
    const data: { status: string; acknowledgedAt?: Date; acknowledgedBy?: string; completedAt?: Date } = {
      status,
    };
    if (status === "acknowledged" && !referral.acknowledgedAt) {
      data.acknowledgedAt = new Date();
      // Display label for the owner's UI — a name/role, never an email.
      data.acknowledgedBy = chv.fullName || chv.role || "staff";
    }
    if (status === "completed" && !referral.completedAt) {
      data.completedAt = new Date();
    }

    await db.referral.update({ where: { id }, data });

    // ---- Audit trail: one row per transition (non-fatal, like triage) ----
    // Event vocabulary: referral_<to> (referral_sent, referral_acknowledged,
    // referral_in_progress, referral_completed, referral_declined,
    // referral_cancelled, referral_expired). County/ward come from the
    // encounter's household; organization/role from the acting session user.
    await writeAuditEntry({
      actorId: chv.id,
      event: `referral_${status}`,
      county: referral.encounter.household?.county ?? "unknown",
      ward: referral.encounter.household?.ward ?? null,
      referralId: referral.id,
      organizationId: chv.organizationId ?? null,
      authorizationRole: chv.role ?? "chv",
    }).catch((e) => {
      console.error("[referrals PATCH] audit log write failed:", e);
    });

    const updated = await getReferralById(id);
    if (!updated) {
      // The row existed moments ago — a concurrent delete is the only path
      // here. 404 keeps the contract honest without leaking detail.
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    // Last-resort guard — unexpected failures surface as a generic 500 with
    // no detail leak (same posture as the other lifecycle PATCH routes).
    console.error("[referrals PATCH] internal error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
