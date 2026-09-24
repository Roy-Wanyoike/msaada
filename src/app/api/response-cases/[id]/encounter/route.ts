import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { createEncounter } from "@/lib/identity-store";
import { getReport, updateCaseStatus } from "@/lib/community-report-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/response-cases/[id]/encounter
 *
 * CR-010 — When a CHV attends a community report, an encounter is created
 * linking the report -> response case -> encounter. Ownership-scoped: only
 * the assigned CHV may create the encounter. If the reported subject is
 * unidentified, NO person record is created automatically (§9 — human
 * confirmation required).
 *
 * Response:
 *   201 — { encounter: EncounterDTO, responseCase: ResponseCaseDTO }
 *   401 — UNAUTHORIZED (no session)
 *   403 — FORBIDDEN (case exists but is assigned to a different CHV)
 *   404 — NOT_FOUND (case id does not exist) | REPORT_NOT_FOUND (orphan case)
 *   409 — SUBJECT_UNIDENTIFIED (no known subjectPersonId/subjectHouseholdId)
 *   409 — ALREADY_ATTENDED (case already has an encounter linked)
 *   409 — CASE_STATE_CHANGED (case reassigned/deleted mid-flight, TOCTOU)
 *   500 — INTERNAL (unexpected error, no detail leaked)
 */
export async function POST(
  _req: Request,
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

    // Pre-fetch the case to split the conflated null-return cases from
    // updateCaseStatus (not-found vs. forbidden). updateCaseStatus itself
    // also re-checks ownership, so this is defense-in-depth (TOCTOU guard).
    const existing = await db.responseCase.findUnique({
      where: { id },
      select: { id: true, assignedChvId: true, encounterId: true, status: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    if (!existing.assignedChvId || existing.assignedChvId !== chv.id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    if (existing.encounterId) {
      // An encounter was already created from this case — idempotency guard.
      return NextResponse.json(
        { error: "ALREADY_ATTENDED", encounterId: existing.encounterId },
        { status: 409 }
      );
    }

    // Fetch the linked report — the subject identity comes from the report,
    // not the case (§9 — the subject is established at intake time).
    const report = await getReport(existing.reportId);
    if (!report) {
      // Orphan case (report deleted before being attended). Should never
      // happen under normal use, but fail safely.
      return NextResponse.json({ error: "REPORT_NOT_FOUND" }, { status: 404 });
    }

    // §9 — NO automatic identity merges. If the subject is unidentified,
    // a human must confirm the identity before an encounter can be created.
    if (!report.subjectPersonId || !report.subjectHouseholdId) {
      return NextResponse.json(
        {
          error: "SUBJECT_UNIDENTIFIED",
          guidance:
            "The reported subject must be identified before an encounter can be created.",
        },
        { status: 409 }
      );
    }

    // Create the encounter for the known person. captureMethod: "community_report"
    // marks the provenance — this encounter was triggered by an inbound report,
    // not a routine household visit.
    const encounter = await createEncounter({
      householdId: report.subjectHouseholdId,
      memberId: report.subjectPersonId,
      chwId: chv.id,
      captureMethod: "community_report",
    });

    // Link the encounter back to the response case and advance the lifecycle
    // to "attended". updateCaseStatus re-checks ownership atomically.
    const updatedCase = await updateCaseStatus({
      caseId: id,
      chvId: chv.id,
      status: "attended",
      encounterId: encounter.id,
    });
    if (!updatedCase) {
      // TOCTOU: the case was reassigned or deleted between our pre-check and
      // the update. The encounter row exists but is now orphaned from the
      // case. Surface a 409 so the client knows to re-fetch the case.
      return NextResponse.json(
        {
          error: "CASE_STATE_CHANGED",
          encounterId: encounter.id,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { encounter, responseCase: updatedCase },
      { status: 201 }
    );
  } catch (err) {
    // Last-resort guard — any unexpected throw (Prisma connectivity, internal
    // type coercion, etc.) surfaces as a generic 500 with no detail leak.
    console.error("[response-cases encounter POST] internal error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
