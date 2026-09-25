import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { analyzeCommunityReport } from "@/lib/ai/report-intake";
import {
  evaluatePolicy,
  type ModelInterpretation,
  type PolicyDecision,
} from "@/lib/policy-engine";
import {
  getReport,
  updateReportAI,
  updateReportPolicy,
  createResponseCase,
} from "@/lib/community-report-store";
import type { CommunityReportDTO, ResponseCaseDTO } from "@/lib/community-report-types";

// Always dynamic — auth + per-request AI classification.
export const dynamic = "force-dynamic";

/**
 * Roles permitted to trigger AI processing of a community report (CR-005).
 *
 * Per the schema's role taxonomy:
 *   moh_admin | moh_officer | county_admin | subcounty_admin |
 *   cho_supervisor | chv | program_admin | auditor | system_admin
 *
 * CHVs, supervisors, and admins may trigger AI intake. Auditors are
 * intentionally excluded — read-only role should not mutate report state.
 * `moh_officer` is included as a working-level MoH role (clerk/records).
 */
const ALLOWED_ROLES = new Set([
  "chv",
  "cho_supervisor",
  "subcounty_admin",
  "county_admin",
  "moh_admin",
  "moh_officer",
  "program_admin",
  "system_admin",
]);

/**
 * Workflow classes that REQUIRE an automatic ResponseCase creation.
 *
 * - crisis_override: emergency referral — must be tracked and assigned
 *   immediately. The AI cannot downgrade this signal (§10).
 * - referral_required: urgent facility referral — must be tracked so a
 *   CHV/supervisor can confirm the referral was acknowledged.
 *
 * Routine + follow_up_required + human_review do NOT auto-create a case:
 * routine needs no action, follow_up_required is a softer revisit (the
 * report itself functions as the open item), and human_review awaits a
 * human decision about what to do (creating a case would pre-empt that).
 */
const CASE_TRIGGER_WORKFLOW_CLASSES = new Set([
  "crisis_override",
  "referral_required",
]);

/**
 * POST /api/community-reports/[id]/process
 *
 * AI Intake (CR-005) + Deterministic Safety Routing (CR-006).
 *
 * Architecture (sections 9, 10, 12):
 *   1. Auth — only CHVs/supervisors/admins may trigger AI intake.
 *   2. Load the report (already PII-scrubbed at submission time).
 *   3. Idempotency — 404 if missing, 409 if already AI-processed.
 *   4. Qwen classifies the concern into a structured triage flag (CR-005).
 *      The AI does NOT diagnose. It only structures the concern.
 *   5. The DETERMINISTIC policy engine evaluates the interpretation (CR-006).
 *      The AI can NEVER override or downgrade a safety signal (§10).
 *      The crisis override rule fires UNCONDITIONALLY when escalation=true.
 *   6. Persist the AI interpretation (status → "triaged") + the policy
 *      decision (status → "ready_for_assignment").
 *   7. If the policy says crisis_override or referral_required, automatically
 *      create a ResponseCase so the supervisor queue picks it up.
 *   8. Return the updated report + the policy decision.
 *
 * Failure semantics (§10): if the AI call fails catastrophically, the report
 * remains at status="received" — no AI fields written, no policy applied.
 * A human can still process it manually. The AI failure does NOT block the
 * report; it only blocks the automated path.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Auth — fail fast on no session.
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  // RBAC: only CHVs / supervisors / admins may trigger AI intake. Auditors
  // are read-only and explicitly excluded from mutating report state.
  if (!ALLOWED_ROLES.has(chv.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  // Defense-in-depth: suspended/deactivated users cannot trigger processing
  // even if they hold an allowed role. The session is checked at request
  // time, so a user suspended after login is immediately locked out here.
  if (chv.authState && chv.authState !== "active") {
    return NextResponse.json({ error: "ACCOUNT_NOT_ACTIVE" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  }

  // 2. Load the report.
  const report = await getReport(id);
  if (!report) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 3. Idempotency — if AI already ran, do not run it again. A re-run would
  //    overwrite the audited policy decision and could mask a safety signal
  //    if the model returned a different verdict the second time. Re-running
  //    is a manual, audited operation, not a side-effect of a retry.
  if (report.aiInterpretation !== null) {
    return NextResponse.json(
      {
        error: "ALREADY_PROCESSED",
        report,
        // Surface the existing workflow class so the caller can route the
        // user to the right next-step UI without a second fetch.
        workflowClass: report.policyWorkflowClass,
      },
      { status: 409 }
    );
  }

  // The concern description was PII-scrubbed at submission time (see
  // community-report-store.createReport). The scrubbed text IS the "raw
  // fact" — re-scrubbing here would be a no-op. De-identification
  // invariant is preserved at the data-access boundary.
  const concernText = report.description;

  try {
    // 4. AI Intake (CR-005) — Qwen structures the concern with a prompt
    //    written for public reports (src/lib/ai/report-intake.ts). It
    //    returns the same triage verdict shape as /api/triage (same crisis
    //    rule, same fallback: crisis keyword screen, then needs_followup),
    //    plus advisory extras for the CHV: summary, urgency, visit questions.
    //    Model failures never throw; anything unexpected propagates to the
    //    outer catch, leaving the report at status="received" (§10 safety:
    //    the AI failure does NOT block the report; a human can still act).
    const { output, fallbackUsed, model: aiModel, promptVersion, intake } =
      await analyzeCommunityReport(concernText);

    // 5. Deterministic Safety Routing (CR-006) — adapt the Qwen output to
    //    the policy engine's ModelInterpretation type (SAME pattern as
    //    /api/triage — no duplication per CR-015). The crisis path
    //    collapses the classification fields into the crisis-specific
    //    fields (chpInstruction, crisisLine) so the policy engine sees a
    //    uniform shape.
    const interpretation: ModelInterpretation = {
      escalation: output.escalation === true,
      // The crisis path doesn't carry a normal classification; assign a
      // sentinel so the policy engine's switch can't accidentally match
      // it. (evaluatePolicy checks escalation FIRST and returns early,
      // so this value is never used in the crisis branch — but it must
      // type-check.)
      classification:
        output.escalation === true
          ? "needs_facility_referral"
          : output.classification,
      observedIndicators:
        output.escalation === true ? [] : output.observed_indicators,
      aggregateTag:
        output.escalation === true
          ? "crisis_self_harm"
          : output.aggregate_tag ?? null,
      chpNextAction:
        output.escalation === true ? null : output.chp_next_action,
      chpInstruction:
        output.escalation === true ? output.chp_instruction : null,
      crisisLine: output.escalation === true ? output.crisis_line : null,
      confidenceNote:
        output.escalation === true
          ? "Crisis override triggered"
          : output.confidence_note ?? null,
      fallbackUsed,
    };

    // evaluatePolicy is PURE — no side effects, no DB, no I/O. It is
    // deterministic: same input → same output. The crisis override rule
    // fires UNCONDITIONALLY when escalation=true, regardless of any other
    // field in the interpretation. The AI CANNOT downgrade this (§10).
    const decision: PolicyDecision = evaluatePolicy(interpretation);

    // 6. Persist the AI interpretation (status → "triaged"). The
    //    aiConfidence is a static 0.85 per the build spec — it is a
    //    coarse disposition marker, not a calibrated probability. The
    //    auditable artifact is the policy decision, not this number.
    //    aiUncertainty holds what the report leaves out (JSON string[]),
    //    so the CHV knows what to find out on the visit.
    await updateReportAI({
      reportId: id,
      // The triage verdict plus the advisory intake extras (summary,
      // urgency, visit questions) shown on the CHV's case card.
      aiInterpretation: JSON.stringify({ ...output, intake }),
      aiModelVersion: `${aiModel} (${promptVersion})`,
      aiConfidence: 0.85,
      aiUncertainty: intake?.missingInformation.length
        ? JSON.stringify(intake.missingInformation)
        : undefined,
    });

    // 7. Persist the deterministic policy decision (status →
    //    "ready_for_assignment"). The workflowClass drives downstream
    //    UI routing (supervisor queue, CHV assignment, crisis banner).
    //    The full decision object is JSON-stringified for audit/replay.
    await updateReportPolicy({
      reportId: id,
      policyVersion: decision.policyVersion,
      policyDecision: JSON.stringify(decision),
      policyWorkflowClass: decision.workflowClass,
    });

    // 8. Auto-create a ResponseCase for crisis_override + referral_required.
    //    This is the unconditional hand-off from policy → operations: a
    //    crisis or referral MUST be tracked through to resolution, so the
    //    case is opened immediately and surfaces in the supervisor's
    //    ready-for-assignment queue.
    let responseCase: ResponseCaseDTO | null = null;
    if (CASE_TRIGGER_WORKFLOW_CLASSES.has(decision.workflowClass)) {
      try {
        responseCase = await createResponseCase(id);
      } catch (err) {
        // Do NOT fail the whole request if the case row couldn't be
        // created — the AI interpretation + policy decision are already
        // persisted, so the report is in a recoverable state. The
        // supervisor can manually create the case from the report's
        // ready_for_assignment status. Log loudly because this is a
        // safety-relevant signal that needs human follow-up.
        console.error(
          `[community-reports/process] createResponseCase failed for report ${id} ` +
            `(workflowClass=${decision.workflowClass}):`,
          err
        );
      }
    }

    // Re-load the report to reflect both updates + the (optional) case
    // creation in responseCaseCount. Cheaper than threading the row
    // through three store calls.
    const updated: CommunityReportDTO | null = await getReport(id);

    // De-identified audit line — includes the workflow decision (§12
    // auditable). Never logs the concern text.
    console.log(
      `[community-reports/process] report=${id} escalation=${decision.isEscalation} ` +
        `workflowClass=${decision.workflowClass} fallback=${fallbackUsed} ` +
        `policy=${decision.policyVersion} case=${responseCase?.id ?? "-"}`
    );

    return NextResponse.json(
      {
        report: updated,
        policyDecision: decision,
        responseCase,
      },
      { status: 200 }
    );
  } catch (err) {
    // §10 safety: if the AI call failed catastrophically (e.g. SDK threw
    // an unhandled error that escaped classifyObservation's internal
    // retry), the report status is STILL "received" — we never reached
    // updateReportAI. A human can process it manually from the report's
    // queue. The error is logged with the report id so ops can correlate.
    console.error(
      `[community-reports/process] AI intake failed for report ${id}:`,
      err
    );
    return NextResponse.json(
      {
        error: "AI_INTAKE_FAILED",
        // Report remains at status="received" — no AI fields written, no
        // policy applied. The caller can retry or process manually.
        report,
        detail:
          "AI intake could not be completed. The report remains at status='received' " +
          "and can still be processed manually. Retry later or assign a human reviewer.",
      },
      { status: 500 }
    );
  }
}
