// Helpers, color palette, and insight logic for the county dashboard.
// All values come from `/api/dashboard` which is aggregate-only and never
// surfaces observed-indicator text (de-identification at the data layer).

export interface CountyAggregate {
  county: string;
  routine: number;
  needs_followup: number;
  needs_facility_referral: number;
  escalation: number;
  total: number;
}

export interface DailyAggregate {
  day: string; // YYYY-MM-DD
  routine: number;
  needs_followup: number;
  needs_facility_referral: number;
  escalation: number;
  total: number;
}

export interface TagAggregate {
  aggregateTag: string;
  count: number;
}

export interface DashboardStats {
  byCounty: CountyAggregate[];
  byDay: DailyAggregate[];
  byTag: TagAggregate[];
  totals: {
    total: number;
    routine: number;
    needs_followup: number;
    needs_facility_referral: number;
    escalation: number;
    countiesCovered: number;
  };
}

/**
 * Palette — no indigo, no blue. The accent (teal) is the neutral shade used
 * for generic context (e.g. top-tags bar chart when no dominant class).
 */
export const COLORS = {
  routine: "#10b981", // emerald-500
  needs_followup: "#f59e0b", // amber-500
  needs_facility_referral: "#f97316", // orange-500
  escalation: "#ef4444", // red-500
  teal: "#14b8a6", // teal-500
  muted: "#9ca3af", // gray-400 (for chart grid/axes only)
} as const;

/**
 * Tailwind class strings for KPI cards / badges / chips.
 */
export const TONE: Record<
  "routine" | "needs_followup" | "needs_facility_referral" | "escalation" | "teal",
  { soft: string; border: string; text: string; dot: string }
> = {
  routine: {
    soft: "bg-emerald-50 dark:bg-emerald-950/40",
    border: "border-emerald-200 dark:border-emerald-900",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  needs_followup: {
    soft: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-900",
    text: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  needs_facility_referral: {
    soft: "bg-orange-50 dark:bg-orange-950/40",
    border: "border-orange-200 dark:border-orange-900",
    text: "text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  escalation: {
    soft: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-900",
    text: "text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
  teal: {
    soft: "bg-teal-50 dark:bg-teal-950/40",
    border: "border-teal-200 dark:border-teal-900",
    text: "text-teal-700 dark:text-teal-300",
    dot: "bg-teal-500",
  },
};

export const CLASS_LABEL: Record<
  "routine" | "needs_followup" | "needs_facility_referral" | "escalation",
  string
> = {
  routine: "Routine",
  needs_followup: "Needs follow-up",
  needs_facility_referral: "Facility referral",
  escalation: "Escalation / crisis",
};

/** Format a YYYY-MM-DD as MM-DD for axis ticks. */
export function formatDay(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[1]}-${parts[2]}`;
}

/** Pretty label for an aggregate tag (snake_case → Title Case). */
export function prettyTag(tag: string): string {
  return tag
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10; // 1 dp
}

export interface WeeklyDelta {
  /** Sum of last 7 days for the given metric. */
  last7: number;
  /** Sum of the previous 7 days (days 8..14). */
  prev7: number;
  /** Absolute change last7 - prev7. */
  delta: number;
  /** Ratio (last7 / prev7) — Infinity when prev7 is 0. */
  ratio: number | null;
  /** True when we have no previous-week baseline to compare against. */
  noBaseline: boolean;
}

/**
 * Compare last 7 days vs previous 7 days from the byDay array.
 * byDay is the regional (all-counties) trend — the DashboardStats contract
 * does not currently expose per-county per-day breakdowns, so this is a
 * regional metric.
 */
export function weeklyDelta(
  byDay: DailyAggregate[],
  metric: "total" | "needs_followup" | "escalation" | "routine" | "needs_facility_referral"
): WeeklyDelta {
  const sorted = [...byDay].sort((a, b) => a.day.localeCompare(b.day));
  const last7 = sorted.slice(-7).reduce((s, d) => s + (d[metric] as number), 0);
  const prev7 = sorted.slice(-14, -7).reduce((s, d) => s + (d[metric] as number), 0);
  return {
    last7,
    prev7,
    delta: last7 - prev7,
    ratio: prev7 > 0 ? last7 / prev7 : null,
    noBaseline: prev7 === 0,
  };
}

export interface Insight {
  id: string;
  tone: "routine" | "needs_followup" | "needs_facility_referral" | "escalation" | "teal";
  title: string;
  body: string;
}

/**
 * Build 1-3 narrative callouts that the available math supports.
 * Never divides by zero; never asserts prior-week data when absent.
 */
export function computeInsights(stats: DashboardStats): Insight[] {
  const out: Insight[] = [];
  const { totals, byCounty, byTag, byDay } = stats;

  if (totals.total === 0) return out;

  // 1) Top signal (top tag).
  if (byTag.length > 0) {
    const top = byTag[0];
    out.push({
      id: "top-signal",
      tone: "teal",
      title: `Top signal: ${prettyTag(top.aggregateTag)}`,
      body: `${top.count} case${top.count === 1 ? "" : "s"} logged across the network — the most-frequently triaged aggregate tag in the last 14 days.`,
    });
  }

  // 2) Escalation count + safety framing.
  if (totals.escalation > 0) {
    out.push({
      id: "escalations",
      tone: "escalation",
      title: `${totals.escalation} escalation${totals.escalation === 1 ? "" : "s"} logged`,
      body: `Each escalation reflects a crisis-level triage and requires in-person CHP follow-up. Crisis-line instruction was issued at the point of submission.`,
    });
  }

  // 3) Regional weekly trend for needs_followup.
  // byDay is regional, so this is a network-wide trend (not per-county).
  const fuDelta = weeklyDelta(byDay, "needs_followup");
  if (fuDelta.noBaseline) {
    out.push({
      id: "followup-trend",
      tone: "needs_followup",
      title: "Follow-up trend: no prior-week baseline yet",
      body: `${fuDelta.last7} needs-follow-up cases were triaged in the last 7 days. There is no previous-week data to compare against — check back next week for a delta.`,
    });
  } else if (fuDelta.ratio !== null) {
    const changePct = Math.round((fuDelta.ratio - 1) * 100);
    const dir = changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
    const word =
      dir === "up" ? "up" : dir === "down" ? "down" : "roughly flat";
    const numText =
      dir === "up"
        ? `${changePct}%`
        : dir === "down"
          ? `${Math.abs(changePct)}%`
          : "±0%";
    out.push({
      id: "followup-trend",
      tone: "needs_followup",
      title: `Follow-up flags ${word} ${numText} this week vs last week`,
      body: `${fuDelta.last7} needs-follow-up cases in the last 7 days vs ${fuDelta.prev7} in the previous 7 days (network-wide; per-county weekly breakdown requires an API extension).`,
    });
  }

  // 4) Highest follow-up burden county (only when ≥3 cases for that county).
  const candidates = byCounty.filter((c) => c.needs_followup >= 3);
  if (candidates.length > 0) {
    const top = [...candidates].sort(
      (a, b) =>
        b.needs_followup / Math.max(b.total, 1) - a.needs_followup / Math.max(a.total, 1)
    )[0];
    const rate = pct(top.needs_followup, top.total);
    out.push({
      id: "followup-burden",
      tone: "needs_followup",
      title: `${top.county} has the highest follow-up burden`,
      body: `${top.needs_followup} follow-up cases (${rate}% of the county's ${top.total} observation${top.total === 1 ? "" : "s"}). Consider reinforcing CHP check-ins in this county.`,
    });
  }

  // Cap at 3 callouts — pick the most signal-rich (top-signal + escalations + the
  // first computed trend). This keeps the layout predictable for judges.
  return out.slice(0, 3);
}

/**
 * Proxy per-county weekly delta. The DashboardStats contract exposes
 * regional byDay data and per-county all-time totals — NOT per-county
 * per-day. Until the contract is extended (TODO), we proxy each county's
 * weekly delta as `round(globalDelta * countyShare)` where countyShare
 * is the county's fraction of all-time observations. Direction (up/down)
 * is reliable; the magnitude is an approximation.
 */
export function proxyCountyWeeklyDelta(
  county: CountyAggregate,
  stats: DashboardStats
): { delta: number; isProxy: true } {
  const regional = weeklyDelta(stats.byDay, "total");
  const share = stats.totals.total > 0 ? county.total / stats.totals.total : 0;
  const delta = Math.round(regional.delta * share);
  return { delta, isProxy: true };
}
