import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { classifyObservation } from "@/lib/qwen";
import { insertTriageRecord } from "@/lib/triage-store";
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
    const { output, fallbackUsed } = await classifyObservation(
      observation_text.trim()
    );
    const record = await insertTriageRecord({
      submittedById: chv.id,
      county: countyTyped,
      ward: wardTyped,
      output,
      fallbackUsed,
    });

    // De-identified log line — raw observation text never appears here.
    console.log(
      `[triage] stored id=${record.id} county=${record.county} ward=${
        record.ward ?? "-"
      } escalation=${record.escalation} classification=${
        record.classification
      } fallback=${fallbackUsed}`
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
