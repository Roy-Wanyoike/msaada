import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { mirrorEncounterDrafts } from "@/lib/supabase-mirror";

export const dynamic = "force-dynamic";

/**
 * POST /api/encounters/drafts — flush queued offline encounter drafts (issue
 * #45, closes the unreachable-sync gap from the capabilities audit).
 *
 * WHY THIS ENDPOINT EXISTS: the draft queue (src/lib/sync/draft-queue.ts)
 * used to flush directly into Supabase `encounter_drafts` from the browser —
 * but that required a Supabase AUTH session, which no Msaada flow ever
 * creates (app auth = own HMAC cookie). The queue therefore grew forever and
 * the "will sync automatically" promise was false. The flush is now a
 * first-party, cookie-authed call to THIS endpoint; the server performs the
 * Supabase write with the publishable (anon) key per supabase/schema.sql §3.
 *
 * Body: { drafts: [{ clientUuid, encounterId, encounterCode, county, ward }] }
 *   - Structured metadata ONLY (no observation free-text — the project
 *     de-identification rule; enforced here by persisting exactly these
 *     fields into the payload jsonb).
 *   - client_uuid idempotency: rows already present in the cloud are skipped
 *     (PostgREST `resolution=ignore-duplicates` on the unique client_uuid),
 *     so replaying the same batch never duplicates and `flushed` counts only
 *     NEWLY inserted rows — a second identical POST returns {flushed: 0}.
 *
 * Returns: { flushed: n } (200) · 401 UNAUTHORIZED · 400 INVALID_BODY ·
 * 429 RATE_LIMITED · 503 SUPABASE_NOT_CONFIGURED · 502 DRAFT_SYNC_FAILED.
 */

interface DraftInput {
  clientUuid?: unknown;
  encounterId?: unknown;
  encounterCode?: unknown;
  county?: unknown;
  ward?: unknown;
}

function asTrimmedString(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim().length > 0
    ? v.trim().slice(0, max)
    : null;
}

export async function POST(req: Request) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Flushes fire on mount + window "online" — a generous but bounded bucket.
  const rl = checkRateLimit(`drafts:${chv.id}`, {
    capacity: 60,
    windowMs: 60_000,
  });
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
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const drafts = (body as { drafts?: unknown } | null)?.drafts;
  if (!Array.isArray(drafts)) {
    return NextResponse.json(
      { error: "INVALID_BODY", field: "drafts" },
      { status: 400 }
    );
  }

  // Normalize + drop unusable entries (a draft without its idempotency key
  // can never be deduplicated — skipping it is safer than guessing).
  const cleaned = drafts
    .map((d) => d as DraftInput)
    .map((d) => ({
      clientUuid: asTrimmedString(d.clientUuid, 100),
      encounterId: asTrimmedString(d.encounterId, 100),
      encounterCode: asTrimmedString(d.encounterCode, 50),
      county: asTrimmedString(d.county, 100),
      ward: asTrimmedString(d.ward, 100),
    }))
    .filter(
      (d): d is {
        clientUuid: string;
        encounterId: string | null;
        encounterCode: string | null;
        county: string | null;
        ward: string | null;
      } => d.clientUuid !== null
    );

  if (cleaned.length === 0) {
    return NextResponse.json({ flushed: 0 });
  }

  try {
    const flushed = await mirrorEncounterDrafts(
      cleaned.map((d) => ({
        clientUuid: d.clientUuid,
        // Metadata-only payload — exactly the fields the queue stores.
        payload: {
          encounterId: d.encounterId,
          encounterCode: d.encounterCode,
          county: d.county,
          ward: d.ward,
        },
        syncedAt: new Date().toISOString(),
      }))
    );
    if (flushed === null) {
      // Supabase env unset — the mirror layer is a documented no-op.
      return NextResponse.json(
        { error: "SUPABASE_NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    // De-identified log line: count only, no payload values.
    console.log(
      `[encounters/drafts] chv=${chv.id.slice(0, 8)} sent=${cleaned.length} flushed=${flushed}`
    );
    return NextResponse.json({ flushed });
  } catch (err) {
    console.error(
      `[encounters/drafts] mirror write failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
    return NextResponse.json({ error: "DRAFT_SYNC_FAILED" }, { status: 502 });
  }
}
