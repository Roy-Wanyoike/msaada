/**
 * Server-side Supabase cloud mirrors (issue #45).
 *
 * Writes the two optional cloud tables documented in supabase/schema.sql:
 *   - community_reports   durable mirror of accepted public reports
 *   - encounter_drafts    cloud copy of queued offline encounter drafts
 *
 * SECURITY POSTURE (repo policy): these calls run server-side with the
 * publishable (anon) key ONLY — the same two NEXT_PUBLIC_SUPABASE_* vars the
 * browser uses. The service/secret role key NEVER appears in app code. The
 * anon role is allowed to INSERT these rows by the RLS policies in
 * supabase/schema.sql; it can never read them back.
 *
 * Reliability contract: every mirror write is best-effort. Callers run these
 * fire-and-forget — a Supabase outage, misconfiguration or timeout must never
 * delay or fail the primary response (the app's own Prisma store is the
 * source of truth; Supabase is an enhancement layer).
 *
 * Observability: outcomes are logged with STATIC messages + HTTP status only.
 * Raw error bodies are never logged (they can embed URLs or auth details).
 */

import { supabaseConfig } from "@/utils/supabase/config";

/** Bounded so a hung Supabase can never pin a request slot or timer. */
const MIRROR_TIMEOUT_MS = 5_000;

/** Columns of supabase/schema.sql §2 (community_reports) we write. */
export interface CommunityReportMirrorRow {
  reportCode: string;
  idempotencyKey: string | null;
  county: string;
  ward: string | null;
  category: string;
  status: string;
  /** ALREADY PII-scrubbed by the caller (the scrubbed text IS the fact). */
  description: string;
  workflowClass: string | null;
  policyVersion: string | null;
}

/**
 * Insert one row into the Supabase `community_reports` mirror.
 * `resolution=ignore-duplicates` + the unique `idempotency_key` make retries
 * (and idempotent replays of the same report) no-ops in the cloud.
 *
 * @returns "inserted" | "skipped" (Supabase unconfigured) — throws on a
 * configured-but-failing write so callers can log the failure.
 */
export async function mirrorCommunityReport(
  row: CommunityReportMirrorRow
): Promise<"inserted" | "skipped"> {
  const config = supabaseConfig();
  if (!config) return "skipped";

  const res = await fetch(
    `${config.url.replace(/\/$/, "")}/rest/v1/community_reports`,
    {
      method: "POST",
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.publishableKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify([
        {
          report_code: row.reportCode,
          idempotency_key: row.idempotencyKey,
          county: row.county,
          ward: row.ward,
          category: row.category,
          status: row.status,
          description: row.description,
          workflow_class: row.workflowClass,
          policy_version: row.policyVersion,
        },
      ]),
      signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    // Static message + status: never the response body.
    throw new Error(`community_reports insert failed (HTTP ${res.status})`);
  }
  return "inserted";
}

/** Columns of supabase/schema.sql §3 (encounter_drafts) we write. */
export interface EncounterDraftMirrorRow {
  clientUuid: string;
  /** Structured metadata only — no free text (de-identification rule). */
  payload: Record<string, unknown>;
  syncedAt: string;
}

/**
 * Upsert a batch of encounter drafts into the Supabase `encounter_drafts`
 * mirror. `on_conflict=client_uuid` + `resolution=ignore-duplicates` give
 * client_uuid idempotency: rows that already exist are skipped, so replaying
 * the same batch never duplicates (and PostgREST returns only the rows it
 * actually inserted, which becomes the "flushed" count).
 *
 * @returns the number of rows newly inserted, or null when Supabase is
 * unconfigured. Throws on a configured-but-failing write.
 */
export async function mirrorEncounterDrafts(
  drafts: EncounterDraftMirrorRow[]
): Promise<number | null> {
  const config = supabaseConfig();
  if (!config) return null;
  if (drafts.length === 0) return 0;

  const res = await fetch(
    `${config.url.replace(/\/$/, "")}/rest/v1/encounter_drafts?on_conflict=client_uuid`,
    {
      method: "POST",
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.publishableKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation,resolution=ignore-duplicates",
      },
      body: JSON.stringify(
        drafts.map((d) => ({
          client_uuid: d.clientUuid,
          payload: d.payload,
          synced_at: d.syncedAt,
        }))
      ),
      signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    throw new Error(`encounter_drafts upsert failed (HTTP ${res.status})`);
  }
  // return=representation + ignore-duplicates → only newly inserted rows
  // come back; that count IS the honest "flushed" number.
  const inserted = (await res.json()) as unknown[];
  return Array.isArray(inserted) ? inserted.length : 0;
}
