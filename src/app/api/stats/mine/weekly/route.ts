import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { qwenConfigured } from "@/lib/ai/client";
import { writeChvWeekly } from "@/lib/ai/summaries";
import { getMyStats } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/mine/weekly — Qwen-written narrative of the signed-in CHV's
 * week, from their own aggregate counts only. Shape matches
 * /api/dashboard/summary: { summary: { headline, points, watch, ... } }.
 */
export async function GET() {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!qwenConfigured()) {
    return NextResponse.json({ error: "AI_NOT_CONFIGURED" }, { status: 503 });
  }
  const rl = checkRateLimit(`chv-weekly:${chv.id}`, { capacity: 5, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [stats, tags, pending, overdue] = await Promise.all([
    getMyStats(chv.id),
    db.triageRecord.groupBy({
      by: ["aggregateTag"],
      where: { submittedById: chv.id, createdAt: { gte: weekAgo }, aggregateTag: { not: null } },
      _count: true,
      orderBy: { _count: { aggregateTag: "desc" } },
      take: 5,
    }),
    db.followUp.count({ where: { chvId: chv.id, status: "pending" } }),
    db.followUp.count({ where: { chvId: chv.id, status: "pending", dueAt: { lt: new Date() } } }),
  ]);
  if (stats.total === 0) {
    return NextResponse.json({ error: "NO_DATA" }, { status: 422 });
  }

  const summary = await writeChvWeekly({
    thisWeek: stats.last7d,
    previousWeek: stats.prev7d,
    allTime: {
      total: stats.total,
      routine: stats.routine,
      needs_followup: stats.needs_followup,
      needs_facility_referral: stats.needs_facility_referral,
      escalation: stats.escalation,
    },
    topSignalsThisWeek: tags.map((t) => ({ aggregateTag: t.aggregateTag ?? "general", count: t._count })),
    followUps: { pending, overdue },
  });
  if (!summary) {
    return NextResponse.json({ error: "SUMMARY_FAILED" }, { status: 502 });
  }
  return NextResponse.json({ summary });
}
