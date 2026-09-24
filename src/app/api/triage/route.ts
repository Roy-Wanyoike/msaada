import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { classifyObservation } from "@/lib/qwen";
import { scrubPII } from "@/lib/pii-scrub";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createFollowUp,
  insertTriageRecord,
  writeAuditEntry,
} from "@/lib/triage-store";
import {
  COUNTIES,
  WARDS,
  type County,
  type TriageRequest,
} from "@/lib/types";

// Always dynamic — auth + per-request classification.
export const dynamic = "force-dynamic";

function bad(error: string, field?: string, status = 400) {
  return NextResponse.json(field ? { error, field } : { error }, { status });
}

/**
 * POST /api/triage
 *
 * Body (TriageRequest): { observation_text, county, ward? }
 * Cookie-auth required (msaada_session). The raw observation_text is passed
 * to Qwen in-memory only and is NEVER persisted or echoed in the response.
 * Only the model-derived structured fields + county/ward + submittedById are
 * stored.
 *
 * De-identification note: console logs after classification intentionally
 * carry only county/ward/escalation/classification — never the free text.
 */
export async function POST(req: Request) {
  // Auth first — fail fast on no session.
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Rate-limit per CHV — production-hardening TODO #4. 10 triage submissions
  // per 60s per CHV. Returns 429 with Retry-After when exceeded.
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
  const { observation_text, county, ward } = body as Partial<TriageRequest>;

  // Validate observation_text: non-empty string, trimmed min 10 chars.
  if (
    typeof observation_text !== "string" ||
    observation_text.trim().length < 10
  ) {
    return bad("MISSING_OR_TOO_SHORT", "observation_text");
  }
  // Validate county.
  if (typeof county !== "string" || !COUNTIES.includes(county as County)) {
    return bad("INVALID_COUNTY", "county");
  }
  const countyTyped = county as County;
  // Validate ward (optional, but if present must belong to county).
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
    // PII scrubber — defense-in-depth BEFORE the model call. The raw text is
    // never persisted, but it IS sent to Qwen. Redact phones, emails,
    // national-ID-like digit runs, and "mama/baba/mtoto + proper name" so the
    // model never sees identifiers. Behavioral context is preserved.
    const { redacted: scrubbedText, redactionCount } = scrubPII(
      observation_text.trim()
    );

    const { output, fallbackUsed } = await classifyObservation(scrubbedText);
    const record = await insertTriageRecord({
      submittedById: chv.id,
      county: countyTyped,
      ward: wardTyped,
      output,
      fallbackUsed,
    });

    // Follow-up tracking — when the triage produces needs_followup or
    // needs_facility_referral (and NOT a crisis, which has its own protocol),
    // create a FollowUp row due in 48h so the CHV can track the recommended
    // next action. Idempotent (won't duplicate for the same record).
    if (
      !record.escalation &&
      (record.classification === "needs_followup" ||
        record.classification === "needs_facility_referral")
    ) {
      await createFollowUp({
        triageRecordId: record.id,
        chvId: chv.id,
      }).catch((e) => {
        console.error("[triage] follow-up create failed:", e);
      });
    }

    // Compliance audit log — records WHO/WHEN/WHERE + the model's verdict,
    // NEVER the observation text or the redacted text. This is the system
    // of record for safety incidents and proves the never-persist invariant.
    await writeAuditEntry({
      triageRecordId: record.id,
      actorId: chv.id,
      event: record.escalation
        ? "crisis_override"
        : fallbackUsed
          ? "fallback_used"
          : "triage_classified",
      county: record.county,
      ward: record.ward,
      classification: record.classification,
      escalation: record.escalation,
      fallbackUsed,
      piiRedactions: redactionCount,
    }).catch((e) => {
      // Audit write failure must not fail the triage response.
      console.error("[triage] audit log write failed:", e);
    });

    // De-identified log line — raw observation text never appears here.
    // Log the scrubber's redaction counts (not the redactions themselves).
    console.log(
      `[triage] stored id=${record.id} county=${record.county} ward=${
        record.ward ?? "-"
      } escalation=${record.escalation} classification=${
        record.classification
      } fallback=${fallbackUsed} scrubbed=${JSON.stringify(redactionCount)}`
    );

    return NextResponse.json(record, { status: 200 });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Never include observation_text in the detail.
    console.error("[triage] unexpected failure:", detail);
    return NextResponse.json(
      { error: "TRIAGE_FAILED", detail },
      { status: 500 }
    );
  }
}
