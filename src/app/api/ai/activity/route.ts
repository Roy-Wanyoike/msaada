import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { WORKFLOW_STEPS } from "@/lib/ai/workflow";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/activity?days=14 — evidence for the "Qwen at work" meter:
 * the workflow steps Qwen performs, plus per-task call counts, success rate
 * and latency from AiActivity (metadata only, no content). Signed-in users.
 */
export async function GET(req: Request) {
  const user = await getSessionChv();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = Number.parseInt(new URL(req.url).searchParams.get("days") ?? "", 10);
  const days = Number.isNaN(parsed) || parsed <= 0 ? 14 : Math.min(parsed, 90);
  const since = new Date(Date.now() - days * 86_400_000);

  const [byTask, models] = await Promise.all([
    db.aiActivity.groupBy({
      by: ["task", "ok"],
      where: { createdAt: { gte: since } },
      _count: true,
      _avg: { latencyMs: true },
    }),
    db.aiActivity.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since }, ok: true },
      _count: true,
      orderBy: { _count: { model: "desc" } },
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
    steps,
    tasks,
    models: models.map((m) => ({ model: m.model, calls: m._count })),
  });
}
