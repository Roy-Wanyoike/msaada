import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { classifyObservation } from "@/lib/ai/triage";
import { scrubPII } from "@/lib/pii-scrub";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createFollowUp,
  insertTriageRecord,
  writeAuditEntry,
} from "@/lib/triage-store";
import {
  evaluatePolicy,
  getDestinationForCategory,
  type ModelInterpretation,
} from "@/lib/policy-engine";
import { db } from "@/lib/db";
import { generateCode } from "@/lib/identity-types";
import {
  COUNTIES,
  WARDS,
  type County,
  type TriageRequest,
} from "@/lib/types";

// Always dynamic -- auth + per-request classification.
export const dynamic = "force-dynamic";

function bad(error: string, field?: string, status = 400) {
  return NextResponse.json(field ? { error, field } : { error }, { status });
}

/**
 * POST /api/triage
 *
 * The full identity-chain + policy-engine flow (spec sections 6, 9, 10, 12, 13, 15):
 *
 *  1. Auth + rate-limit (defense layer 6).
 *  2. PII scrub BEFORE the model call (defense layer 2).
 *  3. Qwen interprets the observation (section 9) -- structured output.
 *  4. DETERMINISTIC POLICY ENGINE evaluates the interpretation (section 10, 12).
 *     The AI can NEVER override or downgrade a safety-critical signal.
 *  5. Persist the de-identified observation (TriageRecord, linked to Encounter).
 *  6. Execute the policy decision -- create a Referral if referral_required.
 *  7. Create a Follow-up if the policy requires it (linked to the Referral).
 *  8. Audit log -- WHO/WHEN/WHERE + model verdict + POLICY VERSION (section 21).
 *
 * Body: { observation_text, county, ward?, encounterId? }
 * Returns: TriageRecordDTO + policyDecision + referralId
 */
export async function POST(req: Request) {
  // 1. Auth -- fail fast on no session.
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Rate-limit per CHV (defense layer 6). 10 triage submissions / 60s.
  const rl = checkRateLimit(`triage:${chv.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter: Math.ceil(rl.retryAfterMs / 1000) },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("INVALID_JSON");
  }
  if (!body || typeof body !== "object") {
    return bad("INVALID_BODY");
  }
  const { observation_text, county, ward, encounterId } = body as Partial<TriageRequest>;

  // Validate observation_text.
  if (
    typeof observation_text !== "string" ||
    observation_text.trim().length < 10
  ) {
    return bad("MISSING_OR_TOO_SHORT", "observation_text");
  }
  if (observation_text.length > 5000) {
    return bad("OBSERVATION_TOO_LONG", "observation_text");
  }
  // Validate county.
  if (typeof county !== "string" || !COUNTIES.includes(county as County)) {
    return bad("INVALID_COUNTY", "county");
  }
  const countyTyped = county as County;
  // Validate ward.
  let wardTyped: string | undefined;
  if (ward !== undefined && ward !== null) {
    if (typeof ward !== "string" || ward.trim().length === 0) {
      return bad("INVALID_WARD", "ward");
    }
    if (!WARDS[countyTyped].includes(ward)) {
      return bad("WARD_NOT_IN_COUNTY", "ward");
    }
    wardTyped = ward;
  }

  try {
    // 2. PII scrub BEFORE the model call (defense layer 2).
    const { redacted: scrubbedText, redactionCount } = scrubPII(
      observation_text.trim()
    );

    // 3. AI interprets (section 9).
    const { output, fallbackUsed, model: aiModel, promptVersion } = await classifyObservation(scrubbedText);

    // 4. DETERMINISTIC POLICY ENGINE (section 10, 12).
    const interpretation: ModelInterpretation = {
      escalation: output.escalation === true,
      classification: output.escalation === true ? "needs_facility_referral" : output.classification,
      observedIndicators: output.escalation === true ? [] : output.observed_indicators,
      aggregateTag: output.escalation === true ? "crisis_self_harm" : (output.aggregate_tag ?? null),
      chpNextAction: output.escalation === true ? null : output.chp_next_action,
      chpInstruction: output.escalation === true ? output.chp_instruction : null,
      crisisLine: output.escalation === true ? output.crisis_line : null,
      confidenceNote: output.escalation === true ? "Crisis override triggered" : (output.confidence_note ?? null),
      fallbackUsed,
    };
    const policyDecision = evaluatePolicy(interpretation);

    // 5. Persist the de-identified observation (linked to the encounter if provided).
    const record = await insertTriageRecord({
      submittedById: chv.id,
      county: countyTyped,
      ward: wardTyped,
      output,
      fallbackUsed,
      aiModel,
      promptVersion,
      encounterId: encounterId || undefined,
    });

    // 6. Execute the policy decision -- create a Referral if the policy says
    //    referral_required or crisis_override (section 13). Referrals require
    //    an encounter (identity chain section 15 -- never create without
    //    knowing the member).
    let referralId: string | null = null;
    if (
      policyDecision.referralPriority &&
      policyDecision.referralCategory &&
      record.encounterId
    ) {
      const encounter = await db.encounter
        .findUnique({
          where: { id: record.encounterId },
          select: { householdId: true, memberId: true },
        })
        .catch(() => null);
      if (encounter) {
        const referral = await db.referral
          .create({
            data: {
              referralCode: generateCode("MSD-REF"),
              encounterId: record.encounterId,
              householdId: encounter.householdId,
              memberId: encounter.memberId,
              category: policyDecision.referralCategory,
              priority: policyDecision.referralPriority,
              destination: getDestinationForCategory(policyDecision.referralCategory),
              status: "created",
              createdById: chv.id,
              createdBy: chv.id,
              followUpRequired: policyDecision.followUpRequired,
            },
          })
          .catch((e) => {
            console.error("[triage] referral create failed:", e);
            return null;
          });
        if (referral) referralId = referral.id;
      }
    }

    // 7. Create a Follow-up if the policy requires it (linked to the referral
    //    if one was created -- section 14). Uses the policy's dueInHours
    //    (24h for crisis, 48h for follow-up/referral).
    if (policyDecision.followUpRequired) {
      await createFollowUp({
        triageRecordId: record.id,
        chvId: chv.id,
        dueInHours: policyDecision.followUpDueHours,
        referralId: referralId || undefined,
      }).catch((e) => {
        console.error("[triage] follow-up create failed:", e);
      });
    }

    // 8. Audit log -- WHO/WHEN/WHERE + model verdict + POLICY VERSION +
    //    workflow decision (section 21). Never the observation text.
    await writeAuditEntry({
      triageRecordId: record.id,
      actorId: chv.id,
      event: policyDecision.isEscalation
        ? "crisis_override"
        : fallbackUsed
          ? "fallback_used"
          : "policy_evaluated",
      county: record.county,
      ward: record.ward,
      classification: record.classification,
      escalation: record.escalation,
      fallbackUsed,
      piiRedactions: redactionCount,
      policyVersion: policyDecision.policyVersion,
      aiModel,
      workflowClass: policyDecision.workflowClass,
      referralId,
    }).catch((e) => {
      console.error("[triage] audit log write failed:", e);
    });

    // De-identified log line -- includes the policy decision (section 12 auditable).
    console.log(
      `[triage] stored id=${record.id} county=${record.county} ward=${
        record.ward ?? "-"
      } escalation=${record.escalation} classification=${
        record.classification
      } fallback=${fallbackUsed} policy=${policyDecision.policyVersion}:${
        policyDecision.workflowClass
      } referral=${referralId ?? "-"} scrubbed=${JSON.stringify(redactionCount)}`
    );

    // Return the record + the policy decision (the client shows the
    // deterministic workflow classification, not just the AI's interpretation).
    return NextResponse.json(
      { ...record, policyDecision, referralId },
      { status: 200 }
    );
  } catch (err) {
    // Log the full error server-side -- never send to client.
    console.error("[triage] unexpected failure:", err);
    return NextResponse.json(
      {
        error: "TRIAGE_FAILED",
        detail:
          "An unexpected error occurred during triage. The observation was not stored.",
      },
      { status: 500 }
    );
  }
}
