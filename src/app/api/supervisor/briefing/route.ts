import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { qwenConfigured } from "@/lib/ai/client";
import { writeSupervisorBriefing } from "@/lib/ai/summaries";
import { getSupervisorRoster } from "@/lib/triage-store";
import { CASE_ASSIGNER_ROLES, NATIONAL_ROLES } from "@/lib/community-report-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/supervisor/briefing?days=14&county=X
 *
 * Qwen workload briefing from the de-identified roster (truncated CHV
 * labels, aggregate counts). Supervisor/admin roles only; county-scoped
 * unless the caller holds a national role.
 */
export async function GET(req: Request) {
  const user = await getSessionChv();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!CASE_ASSIGNER_ROLES.includes(user.role ?? "chv")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (!qwenConfigured()) {
    return NextResponse.json({ error: "AI_NOT_CONFIGURED" }, { status: 503 });
  }
  const rl = checkRateLimit(`supervisor-briefing:${user.id}`, { capacity: 5, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const url = new URL(req.url);
  const parsed = Number.parseInt(url.searchParams.get("days") ?? "", 10);
  const days = Number.isNaN(parsed) || parsed <= 0 ? 14 : Math.min(parsed, 90);
  const national = NATIONAL_ROLES.includes(user.role ?? "");
  const county = national ? url.searchParams.get("county") || undefined : user.county ?? undefined;

  const roster = await getSupervisorRoster(county, days);
  if (roster.rows.length === 0) {
    return NextResponse.json({ error: "NO_DATA" }, { status: 422 });
  }
  const now = Date.now();
  const summary = await writeSupervisorBriefing({
    periodDays: days,
    scope: county ? `${county} County` : "All counties",
    totals: roster.totals,
    chvs: roster.rows.slice(0, 40).map((r) => ({
      label: r.chvLabel,
      ward: r.ward,
      total: r.total,
      needs_followup: r.needs_followup,
      needs_facility_referral: r.needs_facility_referral,
      escalation: r.escalation,
      last7d: r.last7d,
      daysSinceLastSubmission: r.lastSubmission
        ? Math.floor((now - new Date(r.lastSubmission).getTime()) / 86_400_000)
        : null,
    })),
  });
  if (!summary) {
    return NextResponse.json({ error: "SUMMARY_FAILED" }, { status: 502 });
  }
  return NextResponse.json({ summary });
}
