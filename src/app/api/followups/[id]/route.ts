import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { resolveFollowUp, writeAuditEntry } from "@/lib/triage-store";
import { db } from "@/lib/db";
import { scrubPII } from "@/lib/pii-scrub";
import { privacyScan } from "@/lib/ai/privacy";

export const dynamic = "force-dynamic";

const MAX_RESOLUTION_NOTE_LEN = 500;

/**
 * PATCH /api/followups/[id]
 * Resolve a follow-up (mark done/missed). Ownership-scoped — only the
 * assigned CHV can resolve their own follow-up.
 *
 * Body: { status: "done" | "missed", resolutionNote?: string }
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
    const { status, resolutionNote } = (body ?? {}) as {
      status?: string;
      resolutionNote?: unknown;
    };
    if (status !== "done" && status !== "missed") {
      return NextResponse.json(
        { error: "INVALID_STATUS", field: "status" },
        { status: 400 }
      );
    }

    // Validate + cap + scrub the resolution note. Defense-in-depth: a CHV may
    // type a household member's name into the free-text note. If the field is
    // present but not a string, reject (a non-string would TypeError inside
    // resolveFollowUp's `.trim()` call). Empty/whitespace-only notes collapse
    // to undefined (no note persisted).
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
        // Cap before scrubbing so the regex passes run on bounded input.
        const capped = trimmed.slice(0, MAX_RESOLUTION_NOTE_LEN);
        // Regex scrub now; Qwen's second pass runs after the ownership
        // checks below, so rejected requests never reach the model.
        note = scrubPII(capped).redacted;
      }
    }

    // Pre-fetch to split the three conflated null-return cases from
    // resolveFollowUp: not-found (404), not-owned (403), already-resolved (409).
    // Without this pre-check the data-access layer returns null for all three
    // and the route has no way to distinguish them. The triageRecord select
    // also carries the county/ward context the audit row needs.
    const existing = await db.followUp.findUnique({
      where: { id },
      select: {
        id: true,
        chvId: true,
        status: true,
        triageRecordId: true,
        referralId: true,
        triageRecord: { select: { county: true, ward: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    if (existing.chvId !== chv.id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    if (existing.status !== "pending") {
      return NextResponse.json(
        { error: "ALREADY_RESOLVED" },
        { status: 409 }
      );
    }

    // Qwen's second de-identification pass, after the ownership checks.
    if (note) note = (await privacyScan(note)).text;

    const updated = await resolveFollowUp({
      followUpId: id,
      chvId: chv.id,
      status,
      resolutionNote: note,
    });
    if (!updated) {
      // TOCTOU race: a concurrent request resolved this follow-up between our
      // pre-check and the update. 409 is the safe mapping (the row is no
      // longer pending, regardless of who resolved it).
      return NextResponse.json(
        { error: "ALREADY_RESOLVED" },
        { status: 409 }
      );
    }

    // Audit trail (MVP-44): every follow-up resolution lands in the log so
    // the follow-up lifecycle is auditable end-to-end. Event vocabulary:
    // followup_resolved. The row links to the follow-up through its triage
    // record (+ referralId when the follow-up was referral-generated) — the
    // AuditLog model has no dedicated followUpId column. classification
    // carries the resolution outcome (done | missed) so the audit viewer
    // shows what happened. Never the resolution note text.
    await writeAuditEntry({
      triageRecordId: existing.triageRecordId,
      referralId: existing.referralId,
      actorId: chv.id,
      event: "followup_resolved",
      county: existing.triageRecord.county,
      ward: existing.triageRecord.ward,
      classification: status,
      organizationId: chv.organizationId ?? null,
      authorizationRole: chv.role ?? "chv",
    }).catch((e) => {
      console.error("[followups PATCH] audit log write failed:", e);
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    // Last-resort guard — any unexpected throw (Prisma connectivity, internal
    // type coercion, etc.) surfaces as a generic 500 with no detail leak.
    console.error("[followups PATCH] internal error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
