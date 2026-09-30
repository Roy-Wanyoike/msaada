import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { isSupervisorOrAbove } from "@/lib/rbac";
import { qwenConfigured, qwenModelChain } from "@/lib/ai/client";
import { classifyObservation, fallbackTriage } from "@/lib/ai/triage";
import { runTriageEval } from "@/lib/ai/eval/runner";
import { EVAL_FIXTURES, EVAL_FIXTURE_COUNT } from "@/lib/ai/eval/fixtures";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/eval — triage evaluation scorecard (issue #55).
 *
 * Auth + RBAC (#54 helper style): 401 without a session; 403 unless the
 * caller is a supervisor-or-above role (cho_supervisor + county-or-above).
 * Evaluation burns model budget and exposes aggregate quality metrics —
 * not a field-role surface.
 *
 * Live evaluation runs ONLY when QWEN_API_KEY is configured; without it the
 * endpoint still returns a fully-shaped scorecard:
 *   { configured: false, message: "Set QWEN_API_KEY to run evaluation",
 *     deterministicBaseline: <scores of the deterministic fallback path> }
 * The deterministic baseline ALWAYS runs (it needs no key), so the
 * scorecard shape is demonstrable end-to-end today.
 *
 * Query params:
 *  - limit: run at most N live fixtures (default 15 = all, max 15). The
 *    baseline always uses the full fixture set.
 */
export async function GET(req: Request) {
  const user = await getSessionChv();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSupervisorOrAbove(user.role)) {
    return NextResponse.json(
      { error: "FORBIDDEN", requiredRole: "supervisor-or-above" },
      { status: 403 }
    );
  }

  const limitParam = Number.parseInt(
    new URL(req.url).searchParams.get("limit") ?? "",
    10
  );
  const liveLimit =
    Number.isNaN(limitParam) || limitParam <= 0
      ? EVAL_FIXTURE_COUNT
      : Math.min(limitParam, EVAL_FIXTURE_COUNT);

  const generatedAt = new Date().toISOString();

  // ---- Deterministic baseline (always runs — needs no key) ----------------
  const deterministicBaseline = await runTriageEval({
    label: "deterministic-baseline",
    classify: async (text) => fallbackTriage(text, 0),
  });

  const basePayload = {
    generatedAt,
    fixtureCount: EVAL_FIXTURE_COUNT,
    chain: qwenModelChain(),
  };

  if (!qwenConfigured()) {
    return NextResponse.json(
      {
        ...basePayload,
        configured: false,
        message: "Set QWEN_API_KEY to run evaluation",
        deterministicBaseline,
      },
      { status: 200 }
    );
  }

  // ---- Live evaluation (only when configured) ------------------------------
  // Per-call budget: 12s keeps the whole run bounded even when the chain is
  // degraded (the endpoint is an on-demand operator tool, not a hot path).
  const live = await runTriageEval({
    label: "live-qwen",
    fixtures: EVAL_FIXTURES.slice(0, liveLimit),
    classify: (text) => classifyObservation(text, { timeoutMs: 12_000 }),
  });

  return NextResponse.json(
    {
      ...basePayload,
      configured: true,
      liveFixtureCount: liveLimit,
      live,
      deterministicBaseline,
    },
    { status: 200 }
  );
}
