import { parseJsonObject, qwenChat, stringList } from "@/lib/ai/client";
import type { DashboardStats, FollowUpStats } from "@/lib/triage-store";

/**
 * Plain-language summary of the county dashboard for managers.
 *
 * Input is aggregate counts only (the same numbers the dashboard renders);
 * no record, observation text or person-level data reaches the model. The
 * summary is advisory: every claim must be traceable to a number on screen.
 */

export const SUMMARY_PROMPT_VERSION = "dashboard-summary-v1";

export interface DashboardSummary {
  headline: string;
  points: string[];
  watch: string[];
  model: string;
  promptVersion: string;
  generatedAt: string;
}

const SYSTEM_PROMPT = `You write short briefings for Kenyan county health managers about community mental-health triage data collected by Community Health Volunteers (CHVs).

You receive aggregate counts only. Rules:
- Use only the numbers provided. Never invent figures, causes or trends that the data does not show. If data is thin (for example fewer than 10 observations, or only a few days), say so plainly.
- Never diagnose, and never speculate about individuals or households.
- Plain English, short sentences, no jargon. Refer to classifications as: routine, needs follow-up, needs facility referral, crisis escalation.
- "watch" items are things a manager should look into (for example overdue follow-ups, rising escalations, a county with a high share of referrals). Leave it empty if nothing stands out.

Respond with a single JSON object only:
{"headline": "one sentence", "points": ["2 to 4 short bullet sentences"], "watch": ["0 to 2 short bullet sentences"]}`;

export async function summarizeDashboard(input: {
  stats: DashboardStats;
  followUps: FollowUpStats;
  days: number;
  scopeLabel: string;
}): Promise<DashboardSummary | null> {
  const { stats, followUps, days, scopeLabel } = input;
  // Compact, aggregate-only payload. Tags are capped to keep the prompt small.
  const data = {
    scope: scopeLabel,
    period_days: days,
    totals: stats.totals,
    by_county: stats.byCounty,
    daily_totals: stats.byDay.map((d) => ({
      day: d.day,
      total: d.total,
      escalation: d.escalation,
      needs_facility_referral: d.needs_facility_referral,
    })),
    top_signals: stats.byTag.slice(0, 8),
    follow_ups: followUps,
  };

  return writeBriefing("dashboard_summary", SYSTEM_PROMPT, data, SUMMARY_PROMPT_VERSION);
}

/**
 * Shared: send aggregate-only data with a task prompt, get back
 * {headline, points, watch}. Returns null on any failure (callers show a
 * friendly message; nothing else depends on these briefings).
 */
async function writeBriefing(
  task: "dashboard_summary" | "chv_weekly" | "supervisor_briefing",
  systemPrompt: string,
  data: unknown,
  promptVersion: string
): Promise<DashboardSummary | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { content, model } = await qwenChat({
        task,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(data) },
        ],
        json: true,
        temperature: 0.2,
        maxTokens: 600,
      });
      const obj = parseJsonObject(content);
      const headline = typeof obj?.headline === "string" ? obj.headline.trim() : "";
      const points = stringList(obj?.points, 4, 300);
      if (!headline || points.length === 0) continue;
      return {
        headline: headline.slice(0, 300),
        points,
        watch: stringList(obj?.watch, 2, 300),
        model,
        promptVersion,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error(
        `[qwen] ${task} attempt ${attempt} failed:`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }
  return null;
}

const BRIEFING_FORMAT = `Respond with a single JSON object only:
{"headline": "one sentence", "points": ["2 to 4 short bullet sentences"], "watch": ["0 to 2 short bullet sentences"]}`;

// ---------------------------------------------------------------------------
// CHV weekly report narrative
// ---------------------------------------------------------------------------

export const CHV_WEEKLY_PROMPT_VERSION = "chv-weekly-v1";

const CHV_WEEKLY_PROMPT = `You write the weekly activity summary for a Community Health Volunteer (CHV) in Kenya, addressed to them ("you"), to share with their supervisor.

You receive only the CHV's own aggregate counts. Rules:
- Use only the numbers provided; never invent figures or causes.
- Warm, encouraging and factual. Plain English, short sentences.
- Mention the week's volume versus the previous week, the mix of results, and follow-ups still open.
- "watch": follow-ups that are overdue, or crisis escalations that need supervisor attention. Leave empty if none.

${BRIEFING_FORMAT}`;

export async function writeChvWeekly(data: {
  thisWeek: number;
  previousWeek: number;
  allTime: { total: number; routine: number; needs_followup: number; needs_facility_referral: number; escalation: number };
  topSignalsThisWeek: { aggregateTag: string; count: number }[];
  followUps: { pending: number; overdue: number };
}): Promise<DashboardSummary | null> {
  return writeBriefing("chv_weekly", CHV_WEEKLY_PROMPT, data, CHV_WEEKLY_PROMPT_VERSION);
}

// ---------------------------------------------------------------------------
// Supervisor workload briefing
// ---------------------------------------------------------------------------

export const SUPERVISOR_PROMPT_VERSION = "supervisor-briefing-v1";

const SUPERVISOR_PROMPT = `You brief a community-health supervisor in Kenya on their Community Health Volunteers' (CHVs') workload. CHVs appear as short labels (e.g. "CHV a1b2"); use those labels.

You receive per-CHV aggregate counts only. Rules:
- Use only the numbers provided; never invent figures, causes or judgements about people.
- Point out who carries the most escalations or referrals, who has been inactive in the last 7 days, and whether workload looks uneven.
- Supportive tone: the aim is to help the supervisor plan support visits, not to rank staff.
- If there are only a few CHVs or records, say the picture is limited.

${BRIEFING_FORMAT}`;

export async function writeSupervisorBriefing(data: {
  periodDays: number;
  scope: string;
  totals: { chvs: number; total: number; escalations: number };
  chvs: {
    label: string;
    ward: string | null;
    total: number;
    needs_followup: number;
    needs_facility_referral: number;
    escalation: number;
    last7d: number;
    daysSinceLastSubmission: number | null;
  }[];
}): Promise<DashboardSummary | null> {
  return writeBriefing("supervisor_briefing", SUPERVISOR_PROMPT, data, SUPERVISOR_PROMPT_VERSION);
}
