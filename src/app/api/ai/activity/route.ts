import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { WORKFLOW_STEPS } from "@/lib/ai/workflow";
import { qwenModelChain } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/activity?days=14 — evidence for the "Qwen at work" meter:
 * the workflow steps Qwen performs, plus per-task call counts, success rate
 * and latency from AiActivity (metadata only, no content). Signed-in users.
 *
 * Also returns per-model health (calls, ok-rate, p50/p95 latency, fallback
 * share) — the measurable backbone of the AI evaluation panel: the fallback
 * chain makes failover automatic, this makes it visible.
 */
export async function GET(req: Request) {
  const user = await getSessionChv();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = Number.parseInt(new URL(req.url).searchParams.get("days") ?? "", 10);
  const days = Number.isNaN(parsed) || parsed <= 0 ? 14 : Math.min(parsed, 90);
  const since = new Date(Date.now() - days * 86_400_000);

  const [byTask, modelRows] = await Promise.all([
    db.aiActivity.groupBy({
      by: ["task", "ok"],
      where: { createdAt: { gte: since } },
      _count: true,
      _avg: { latencyMs: true },
    }),
    // Raw rows for percentile math (groupBy can't do p50/p95 in SQLite).
    // Bounded window — the demo volume makes this a few hundred rows at most.
    db.aiActivity.findMany({
      where: { createdAt: { gte: since } },
      select: { model: true, ok: true, latencyMs: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
  ]);

  const tasks: Record<string, { calls: number; ok: number; avgLatencyMs: number | null }> = {};
  for (const g of byTask) {
    const t = (tasks[g.task] ??= { calls: 0, ok: 0, avgLatencyMs: null });
    t.calls += g._count;
    if (g.ok) {
      t.ok += g._count;
      t.avgLatencyMs = g._avg.latencyMs === null ? null : Math.round(g._avg.latencyMs);
    }
  }

  const steps = WORKFLOW_STEPS.map((s) => ({
    ...s,
    calls: s.tasks.reduce((n, t) => n + (tasks[t]?.ok ?? 0), 0),
  }));
  const qwenSteps = steps.filter((s) => s.performer === "qwen");
  const totalCalls = Object.values(tasks).reduce((n, t) => n + t.calls, 0);
  const okCalls = Object.values(tasks).reduce((n, t) => n + t.ok, 0);

  // ---- Per-model health ------------------------------------------------
  // Primary model = head of the configured failover chain. "Fallback share"
  // = share of SUCCESSFUL calls served by a non-primary model — the honest
  // measure of how often failover actually carried the product.
  const primary = qwenModelChain()[0];
  interface ModelStat {
    model: string;
    calls: number;
    ok: number;
    okRate: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    fallbackShare: number | null; // % of this model's successful calls that were failovers
  }
  const byModel = new Map<string, { calls: number; ok: number; latencies: number[] }>();
  for (const r of modelRows) {
    const m = byModel.get(r.model) ?? { calls: 0, ok: 0, latencies: [] };
    m.calls += 1;
    if (r.ok) {
      m.ok += 1;
      m.latencies.push(r.latencyMs);
    }
    byModel.set(r.model, m);
  }
  const percentile = (sorted: number[], p: number): number | null => {
    if (sorted.length === 0) return null;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return Math.round(sorted[Math.max(0, idx)]);
  };
  const primaryOk = byModel.get(primary)?.ok ?? 0;
  const totalOkAll = [...byModel.values()].reduce((n, m) => n + m.ok, 0);
  const modelHealth: ModelStat[] = [...byModel.entries()]
    .map(([model, m]) => {
      const sorted = [...m.latencies].sort((a, b) => a - b);
      return {
        model,
        calls: m.calls,
        ok: m.ok,
        okRate: m.calls ? Math.round((m.ok / m.calls) * 100) : null,
        p50LatencyMs: percentile(sorted, 50),
        p95LatencyMs: percentile(sorted, 95),
        fallbackShare:
          m.ok > 0 && model !== primary
            ? Math.round((m.ok / Math.max(1, totalOkAll - primaryOk)) * 100)
            : null,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  return NextResponse.json({
    days,
    coverage: {
      qwenSteps: qwenSteps.length,
      totalSteps: steps.length,
      percent: Math.round((qwenSteps.length / steps.length) * 100),
      activeQwenSteps: qwenSteps.filter((s) => s.calls > 0).length,
    },
    totals: {
      calls: totalCalls,
      ok: okCalls,
      successRate: totalCalls ? Math.round((okCalls / totalCalls) * 100) : null,
    },
    primaryModel: primary,
    modelHealth,
    steps,
    tasks,
    models: modelHealth.map((m) => ({ model: m.model, calls: m.calls })),
  });
}
