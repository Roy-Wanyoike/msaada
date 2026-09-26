/**
 * Health probes — shared by GET /api/health and the /status page (issue #17).
 *
 * Design rules:
 *  - Non-throwing: every failure mode maps to a status word, so the API route
 *    can never 500 and the /status page can never render an error boundary.
 *  - Bounded: probes run in parallel and each is guarded by a ~3s timeout.
 *  - Status words ONLY. Env values, keys, URLs and raw error strings are
 *    never returned OR logged — Prisma/fetch error messages can embed
 *    connection strings, so a failed probe logs its name and nothing else.
 *
 * Overall status policy (documented decision):
 *  "ok"       — every probe returned "ok".
 *  "degraded" — anything else, including "not_configured". A health endpoint
 *               exists to surface missing wiring; the /status page renders
 *               "not_configured" as a distinct amber state so operators can
 *               tell "not configured" apart from "down" at a glance, but the
 *               machine-readable verdict stays "degraded" until everything
 *               is genuinely green.
 */

import { db } from "@/lib/db";
import { qwenConfigured } from "@/lib/ai/client";
import { supabaseConfig } from "@/utils/supabase/config";

export const HEALTH_VERSION = "1.1.0";

export type CheckStatus = "ok" | "error" | "not_configured";

export interface Checks {
  database: CheckStatus;
  qwen: CheckStatus;
  supabase: CheckStatus;
}

export interface HealthReport {
  status: "ok" | "degraded";
  checks: Checks;
  timestamp: string;
  version: string;
}

const PROBE_TIMEOUT_MS = 3_000;

/** Reject unless `p` settles within `ms`. The loser keeps running in the
 *  background — we just stop waiting on it (its eventual rejection is caught
 *  by the caller's try/catch-free race with a settled promise). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`probe exceeded ${ms}ms timeout`)),
      ms
    );
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Database — Prisma SELECT 1 through the project's existing client export.
 */
export async function checkDatabase(): Promise<CheckStatus> {
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS);
    return "ok";
  } catch {
    // Server-side log only: probe name, never the error object (Prisma
    // failures can quote the DATABASE_URL / file path).
    console.error("[health] database probe failed");
    return "error";
  }
}

/**
 * Qwen — config presence check ONLY. No model call, no tokens burned.
 * Reuses qwenConfigured() so the health report and the AI client can never
 * drift apart on what "configured" means.
 */
export async function checkQwen(): Promise<CheckStatus> {
  return qwenConfigured() ? "ok" : "not_configured";
}

/**
 * Supabase — "not_configured" when the required auth URL/publishable key is
 * unset. Otherwise hit the public Auth health endpoint; any 2xx counts as ok.
 */
export async function checkSupabase(): Promise<CheckStatus> {
  const config = supabaseConfig();
  if (!config) return "not_configured";
  try {
    const healthUrl = new URL("/auth/v1/health", config.url);
    const res = await fetch(healthUrl, {
      // Supabase (GoTrue) rejects unauthenticated requests with 401 — the
      // publishable key is public-by-design and safe to send as the apikey.
      headers: { apikey: config.publishableKey },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    return res.ok ? "ok" : "error";
  } catch {
    console.error("[health] supabase probe failed");
    return "error";
  }
}

/**
 * Run all three probes in parallel. Never throws, never rejects — each probe
 * is internally caught and the extra .catch is a belt-and-braces guarantee.
 */
export async function runHealthChecks(): Promise<HealthReport> {
  const [database, qwen, supabase] = await Promise.all([
    checkDatabase().catch(() => "error" as const),
    checkQwen().catch(() => "error" as const),
    checkSupabase().catch(() => "error" as const),
  ]);

  const checks: Checks = { database, qwen, supabase };

  // Overall policy: all three "ok" → "ok"; anything else ("error" or
  // "not_configured") → "degraded". Rationale in the module docblock.
  const status =
    checks.database === "ok" &&
    checks.qwen === "ok" &&
    checks.supabase === "ok"
      ? "ok"
      : "degraded";

  return {
    status,
    checks,
    timestamp: new Date().toISOString(),
    version: HEALTH_VERSION,
  };
}
