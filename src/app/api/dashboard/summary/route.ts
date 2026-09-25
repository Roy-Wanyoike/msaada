import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { qwenConfigured } from "@/lib/ai/client";
import { summarizeDashboard, type DashboardSummary } from "@/lib/ai/summaries";
import {
  getDashboardStats,
  getDashboardStatsForCounty,
  getFollowUpStats,
} from "@/lib/triage-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/summary?days=14&scope=mine|all
 *
 * AI-written summary of the same aggregates /api/dashboard returns, with the
 * same county scoping. Requires a session (each call costs model tokens).
 * Cached in memory for 10 minutes per scope + range; ?refresh=1 bypasses it.
 */

const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; summary: DashboardSummary }>();

export async function GET(req: Request) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!qwenConfigured()) {
    return NextResponse.json({ error: "AI_NOT_CONFIGURED" }, { status: 503 });
  }

  const url = new URL(req.url);
  const parsedDays = Number.parseInt(url.searchParams.get("days") ?? "", 10);
  const days = Number.isNaN(parsedDays) || parsedDays <= 0 ? 14 : Math.min(parsedDays, 90);
  const scopeCounty =
    url.searchParams.get("scope") === "mine" && chv.county ? chv.county : null;
  const key = `${scopeCounty ?? "all"}:${days}`;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS && url.searchParams.get("refresh") !== "1") {
    return NextResponse.json({ summary: cached.summary, cached: true });
  }

  const rl = checkRateLimit(`summary:${chv.id}`, { capacity: 5, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter: Math.ceil(rl.retryAfterMs / 1000) },
      { status: 429 }
    );
  }

  const [stats, followUps] = await Promise.all([
    scopeCounty ? getDashboardStatsForCounty(scopeCounty, days) : getDashboardStats(days),
    getFollowUpStats({ county: scopeCounty ?? undefined, days }),
  ]);
  if (stats.totals.total === 0) {
    return NextResponse.json({ error: "NO_DATA" }, { status: 422 });
  }

  const summary = await summarizeDashboard({
    stats,
    followUps,
    days,
    scopeLabel: scopeCounty ? `${scopeCounty} County` : "All counties",
  });
  if (!summary) {
    return NextResponse.json({ error: "SUMMARY_FAILED" }, { status: 502 });
  }
  cache.set(key, { at: Date.now(), summary });
  return NextResponse.json({ summary, cached: false });
}
