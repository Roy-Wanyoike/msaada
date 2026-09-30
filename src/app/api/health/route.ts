import { NextResponse } from "next/server";
import {
  HEALTH_VERSION,
  runHealthChecks,
  type Checks,
  type HealthReport,
} from "@/lib/health";

// Probes hit the database and (optionally) the network — never cache.
export const dynamic = "force-dynamic";

/**
 * GET /api/health — public liveness probe (issue #17).
 *
 * Response shape:
 *   { status: "ok" | "degraded",
 *     checks: { database, qwen, supabase },   // "ok" | "error" | "not_configured"
 *     sessionSecret: "configured" | "ephemeral" | "demo",  // mode only, never the value (issue #53)
 *     timestamp: <ISO string>, version: "1.2.0" }
 *
 * Always HTTP 200 with status words only: missing configuration is reported
 * as "not_configured" (not an endpoint failure), errors as "error". No env
 * values, keys, URLs or error details are ever echoed. "qwen" is a config
 * presence check — it never calls the model API.
 */
export async function GET() {
  try {
    const report = await runHealthChecks();
    return NextResponse.json(report, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    // Unreachable in practice (runHealthChecks never throws) — kept as a
    // hard guarantee that this endpoint NEVER 500s. Log name only.
    console.error("[health] unexpected failure:", err instanceof Error ? err.name : "unknown");
    const checks: Checks = { database: "error", qwen: "error", supabase: "error" };
    const report: HealthReport = {
      status: "degraded",
      checks,
      // Unreachable in practice; conservative mode value (never the secret).
      sessionSecret: "demo",
      timestamp: new Date().toISOString(),
      version: HEALTH_VERSION,
    };
    return NextResponse.json(report, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
