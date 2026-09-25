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

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { content, model } = await qwenChat({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
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
        promptVersion: SUMMARY_PROMPT_VERSION,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error(
        `[qwen] dashboard summary attempt ${attempt} failed:`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }
  return null;
}
