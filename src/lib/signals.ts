import { db } from "@/lib/db";

// ============================================================================
// Early-warning signals — deterministic aggregate change detection (MVP-43).
//
// Pure threshold math over two rolling 7-day windows (current vs baseline).
// NO AI anywhere: no model calls, no embeddings, no LLM post-processing —
// every signal is reproducible from the counts alone and every threshold is
// a named constant below.
//
// Framing contract (mirrors the deterministic policy engine): signals flag
// unusual aggregate changes FOR HUMAN INVESTIGATION. They are not diagnoses
// and never trigger automatic action. Messages are phrased operationally and
// each signal carries an investigationHint pointing at the concrete screen.
// ============================================================================

/** All thresholds in one place — deterministic and reviewable. */
export const SIGNAL_THRESHOLDS = {
  /** Size of the comparison windows, in days. */
  windowDays: 7,
  /** Minimum baseline count for a ratio to be meaningful. */
  minBaseline: 3,
  /** current/baseline ratio at which a count signal first fires (watch). */
  ratioTrigger: 1.5,
  /** current/baseline ratio at which a count signal becomes an alert. */
  alertRatio: 2.0,
  /** With no meaningful baseline, current-window count needed to fire (watch). */
  noBaselineMinCurrent: 5,
  /** Crisis escalations within the current window that constitute a cluster. */
  crisisCountAlert: 2,
  /** Percentage-point completion-rate drop (current vs baseline) that fires. */
  referralCompletionDropPct: 20,
  /** Minimum growth in overdue pending follow-ups over the window that fires. */
  overdueGrowthMin: 2,
  /** Hard cap on signals returned per request (sorted; strongest first). */
  maxSignals: 10,
} as const;

export type SignalKind =
  | "followup_demand_spike"
  | "crisis_cluster"
  | "referral_completion_drop"
  | "overdue_followup_growth"
  | "tag_spike";

export type SignalSeverity = "watch" | "alert";

export interface SignalMetric {
  /** Value in the current window (count, or % for completion-drop). */
  current: number;
  /** Value in the baseline window (count, or % for completion-drop). */
  baseline: number;
  /** current - baseline (negative = decrease). */
  delta: number;
  /** current / baseline rounded to 1dp; null when baseline is 0. */
  ratio: number | null;
}

export interface Signal {
  /** Deterministic: `${kind}:${county}:${ward ?? "all"}:${tag ?? "all"}`. */
  id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  county: string;
  ward: string | null;
  /** Aggregate tag (tag_spike only; null for every other kind). */
  tag: string | null;
  metric: SignalMetric;
  message: string;
  /** Points at the concrete screen where a human investigates the signal. */
  investigationHint: string;
}

export interface SignalsResult {
  generatedAt: string;
  window: {
    current: { start: string; end: string };
    baseline: { start: string; end: string };
  };
  signals: Signal[];
  note: string;
}

/** The framing contract, surfaced verbatim by the API and the dashboard panel. */
export const SIGNALS_NOTE =
  "Signals flag unusual aggregate changes for human investigation. They are not diagnoses and never act on their own.";

// ---------------------------------------------------------------------------
// Pure threshold helpers (unit-checkable without a database).
// ---------------------------------------------------------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface RatioSignalOutcome {
  /** false → the (current, baseline) pair sits below the noise floor; emit nothing. */
  fires: boolean;
  /** null when the pair is suppressed. */
  severity: SignalSeverity | null;
  /** current / baseline rounded to 1dp; null when baseline is 0. */
  ratio: number | null;
}

/**
 * Shared math for the two ratio-shaped count signals (followup_demand_spike,
 * tag_spike).
 *
 * - Noise floor: a baseline below `minBaseline` makes ratios meaningless —
 *   suppress UNLESS the current window is large enough to speak for itself
 *   (`noBaselineMinCurrent`). With no baseline at all the signal fires at
 *   `watch` only (there is no denominator to prove an alert-level surge).
 * - Severity thresholds are evaluated on the RAW ratio; rounding to 1dp is
 *   display-only so the math stays exact.
 */
export function evaluateRatioSignal(
  current: number,
  baseline: number
): RatioSignalOutcome {
  const ratio = baseline > 0 ? round1(current / baseline) : null;
  if (
    baseline < SIGNAL_THRESHOLDS.minBaseline &&
    current < SIGNAL_THRESHOLDS.noBaselineMinCurrent
  ) {
    return { fires: false, severity: null, ratio };
  }
  const rawRatio = baseline > 0 ? current / baseline : null;
  if (rawRatio === null) {
    // No baseline at all: the current window speaks for itself, but without a
    // denominator there is no proof of a surge — fire at watch only.
    return { fires: true, severity: "watch", ratio };
  }
  // Below ratioTrigger the movement is ordinary variation — no signal.
  if (rawRatio < SIGNAL_THRESHOLDS.ratioTrigger) {
    return { fires: false, severity: null, ratio };
  }
  const severity: SignalSeverity =
    rawRatio >= SIGNAL_THRESHOLDS.alertRatio ? "alert" : "watch";
  return { fires: true, severity, ratio };
}

/** "Malindi Town (Kilifi)" — or just the county when no ward is known. */
function place(county: string, ward: string | null): string {
  return ward ? `${ward} (${county})` : county;
}

function signalId(
  kind: SignalKind,
  county: string,
  ward: string | null,
  tag: string | null
): string {
  return `${kind}:${county}:${ward ?? "all"}:${tag ?? "all"}`;
}

const SEVERITY_RANK: Record<SignalSeverity, number> = { alert: 0, watch: 1 };

// ---------------------------------------------------------------------------
// getSignals — the only data function in this module.
// ---------------------------------------------------------------------------

/**
 * Detect unusual aggregate changes across the current vs previous window.
 *
 * Windows are calendar-aligned so they line up with the dashboard's
 * /dashboard?days=7 view (the screen the hints point at): the current window
 * runs from the start of the day `windowDays - 1` days ago through now; the
 * baseline is the preceding `windowDays` days.
 *
 * Data sources (4 deterministic queries):
 *  1-2. Two TriageRecord groupBy windows (one per window) grouped by
 *       county + ward + classification + aggregateTag + escalation, from
 *       which followup_demand_spike, crisis_cluster and tag_spike are
 *       derived. Aggregate-only — no observation text is ever selected.
 *  3.   Referrals in both windows (with encounter → household county/ward)
 *       for referral_completion_drop.
 *  4.   Pending follow-ups past due, bucketed by whether they were already
 *       overdue when the window opened, for overdue_followup_growth.
 *
 * Output: sorted alert→watch then delta desc (deterministic tie-breakers),
 * capped at `maxSignals`. Quiet windows simply yield signals: [] — the 200
 * response is always well-formed.
 */
export async function getSignals(opts?: {
  county?: string;
}): Promise<SignalsResult> {
  const now = new Date();
  const windowDays = SIGNAL_THRESHOLDS.windowDays;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const currentStart = new Date(startOfToday);
  currentStart.setDate(currentStart.getDate() - (windowDays - 1));
  const baselineStart = new Date(currentStart);
  baselineStart.setDate(baselineStart.getDate() - windowDays);

  const county = opts?.county;

  const [currentGroups, baselineGroups, referrals, overduePending] =
    await Promise.all([
      db.triageRecord.groupBy({
        by: ["county", "ward", "classification", "aggregateTag", "escalation"],
        _count: true,
        where: {
          ...(county ? { county } : {}),
          createdAt: { gte: currentStart, lte: now },
        },
      }),
      db.triageRecord.groupBy({
        by: ["county", "ward", "classification", "aggregateTag", "escalation"],
        _count: true,
        where: {
          ...(county ? { county } : {}),
          createdAt: { gte: baselineStart, lt: currentStart },
        },
      }),
      // Referral lifecycle health. Scope via encounter → household (the
      // referral's home catchment), matching the dashboard's county/ward
      // dimensions.
      db.referral.findMany({
        where: {
          createdAt: { gte: baselineStart, lte: now },
          ...(county
            ? { encounter: { household: { county } } }
            : {}),
        },
        select: {
          status: true,
          createdAt: true,
          encounter: {
            select: { household: { select: { county: true, ward: true } } },
          },
        },
      }),
      // Overdue follow-ups still pending. `dueAt < now` = overdue right now;
      // those already overdue before the window opened form the baseline.
      db.followUp.findMany({
        where: {
          status: "pending",
          dueAt: { lt: now },
          ...(county ? { triageRecord: { county } } : {}),
        },
        select: {
          dueAt: true,
          triageRecord: { select: { county: true, ward: true } },
        },
      }),
    ]);

  // --- Aggregate the groupBy rows into per-scope counters -------------------

  interface ScopeCount {
    county: string;
    ward: string | null;
    current: number;
    baseline: number;
  }
  const demand = new Map<string, ScopeCount>();
  const crisis = new Map<string, ScopeCount>();
  const tags = new Map<string, ScopeCount & { tag: string }>();

  const demandKey = (county: string, ward: string | null) =>
    `demand:${county}::${ward ?? ""}`;
  const crisisKey = (county: string, ward: string | null) =>
    `crisis:${county}::${ward ?? ""}`;
  const tagKey = (county: string, tag: string) => `tag:${county}::${tag}`;

  const ensureScope = (
    map: Map<string, ScopeCount>,
    key: string,
    county: string,
    ward: string | null
  ): ScopeCount => {
    let entry = map.get(key);
    if (!entry) {
      entry = { county, ward, current: 0, baseline: 0 };
      map.set(key, entry);
    }
    return entry;
  };

  const absorb = (
    groups: Array<{
      county: string;
      ward: string | null;
      classification: string;
      aggregateTag: string | null;
      escalation: boolean;
      _count: number;
    }>,
    into: "current" | "baseline"
  ) => {
    for (const g of groups) {
      const isDemand =
        g.classification === "needs_followup" ||
        g.classification === "needs_facility_referral";
      if (isDemand) {
        const entry = ensureScope(
          demand,
          demandKey(g.county, g.ward),
          g.county,
          g.ward
        );
        entry[into] += g._count;
      }
      if (g.escalation) {
        const entry = ensureScope(
          crisis,
          crisisKey(g.county, g.ward),
          g.county,
          g.ward
        );
        entry[into] += g._count;
      }
      if (g.aggregateTag) {
        const key = tagKey(g.county, g.aggregateTag);
        let entry = tags.get(key);
        if (!entry) {
          entry = { county: g.county, ward: null, tag: g.aggregateTag, current: 0, baseline: 0 };
          tags.set(key, entry);
        }
        entry[into] += g._count;
      }
    }
  };

  absorb(currentGroups, "current");
  absorb(baselineGroups, "baseline");

  // --- Emit signals ---------------------------------------------------------

  const signals: Signal[] = [];

  // 1) followup_demand_spike — per (county, ward), needs_followup +
  //    needs_facility_referral counts (crisis rows classify as
  //    needs_facility_referral, so they are part of the demand signal too).
  for (const entry of demand.values()) {
    const outcome = evaluateRatioSignal(entry.current, entry.baseline);
    if (!outcome.fires) continue;
    signals.push({
      id: signalId("followup_demand_spike", entry.county, entry.ward, null),
      kind: "followup_demand_spike",
      severity: outcome.severity as SignalSeverity,
      county: entry.county,
      ward: entry.ward,
      tag: null,
      metric: {
        current: entry.current,
        baseline: entry.baseline,
        delta: entry.current - entry.baseline,
        ratio: outcome.ratio,
      },
      message:
        entry.baseline > 0
          ? `Needs-follow-up triages in ${place(entry.county, entry.ward)} rose to ${entry.current} this week vs ${entry.baseline} last week (×${outcome.ratio}). Review the underlying cases — this is an operational signal, not a diagnosis.`
          : `Needs-follow-up triages in ${place(entry.county, entry.ward)} rose to ${entry.current} this week vs none last week. Review the underlying cases — this is an operational signal, not a diagnosis.`,
      investigationHint:
        "Review the flagged cases in /cases and the 7-day trend on /dashboard?days=7.",
    });
  }

  // 2) crisis_cluster — per (county, ward) on the escalation boolean. Any
  //    cluster at or above crisisCountAlert is an alert: crisis escalations
  //    are never demoted to a soft watch signal.
  for (const entry of crisis.values()) {
    if (entry.current < SIGNAL_THRESHOLDS.crisisCountAlert) continue;
    const ratio =
      entry.baseline > 0 ? round1(entry.current / entry.baseline) : null;
    signals.push({
      id: signalId("crisis_cluster", entry.county, entry.ward, null),
      kind: "crisis_cluster",
      severity: "alert",
      county: entry.county,
      ward: entry.ward,
      tag: null,
      metric: {
        current: entry.current,
        baseline: entry.baseline,
        delta: entry.current - entry.baseline,
        ratio,
      },
      message:
        entry.baseline > 0
          ? `Crisis escalations in ${place(entry.county, entry.ward)} reached ${entry.current} this week vs ${entry.baseline} last week. Review these cases and confirm the crisis protocol was followed — this is an operational signal, not a diagnosis.`
          : `Crisis escalations in ${place(entry.county, entry.ward)} reached ${entry.current} this week (none were triaged last week). Review these cases and confirm the crisis protocol was followed — this is an operational signal, not a diagnosis.`,
      investigationHint:
        "Review the escalation cases in /cases and confirm crisis-line contact was made.",
    });
  }

  // 3) tag_spike — per (aggregateTag, county).
  for (const entry of tags.values()) {
    const outcome = evaluateRatioSignal(entry.current, entry.baseline);
    if (!outcome.fires) continue;
    signals.push({
      id: signalId("tag_spike", entry.county, null, entry.tag),
      kind: "tag_spike",
      severity: outcome.severity as SignalSeverity,
      county: entry.county,
      ward: null,
      tag: entry.tag,
      metric: {
        current: entry.current,
        baseline: entry.baseline,
        delta: entry.current - entry.baseline,
        ratio: outcome.ratio,
      },
      message:
        entry.baseline > 0
          ? `Observations tagged "${entry.tag}" in ${place(entry.county, null)} rose to ${entry.current} this week vs ${entry.baseline} last week (×${outcome.ratio}). Review the underlying cases — this is an operational signal, not a diagnosis.`
          : `Observations tagged "${entry.tag}" in ${place(entry.county, null)} reached ${entry.current} this week vs none last week. Review the underlying cases — this is an operational signal, not a diagnosis.`,
      investigationHint:
        'Check "Top aggregate tags" on /dashboard?days=7 and open the matching cases in /cases.',
    });
  }

  // 4) referral_completion_drop — completion rate (status "completed") in the
  //    current window vs the baseline window, per (county, ward). Needs at
  //    least one referral in EACH window so a rate exists on both sides; the
  //    sample sizes are surfaced in the message so a human can judge them.
  const rate = (completed: number, total: number): number | null =>
    total > 0 ? round1((completed / total) * 100) : null;

  const refScopes = new Map<string, { county: string; ward: string | null }>();
  for (const r of referrals) {
    const county = r.encounter.household.county;
    const ward = r.encounter.household.ward;
    refScopes.set(`ref:${county}::${ward ?? ""}`, { county, ward });
  }

  for (const scope of refScopes.values()) {
    const rows = referrals.filter(
      (r) =>
        r.encounter.household.county === scope.county &&
        (r.encounter.household.ward ?? null) === scope.ward
    );
    const currentRows = rows.filter((r) => r.createdAt >= currentStart);
    const baselineRows = rows.filter((r) => r.createdAt < currentStart);
    if (currentRows.length === 0 || baselineRows.length === 0) continue;
    const curDone = currentRows.filter((r) => r.status === "completed").length;
    const baseDone = baselineRows.filter((r) => r.status === "completed").length;
    const curRate = rate(curDone, currentRows.length);
    const baseRate = rate(baseDone, baselineRows.length);
    if (curRate === null || baseRate === null) continue;
    const drop = round1(baseRate - curRate);
    if (drop < SIGNAL_THRESHOLDS.referralCompletionDropPct) continue;
    // Severity mirrors the ratio signals' pattern: the alert bar is twice the
    // watch/trigger threshold.
    const severity: SignalSeverity =
      drop >= SIGNAL_THRESHOLDS.referralCompletionDropPct * 2
        ? "alert"
        : "watch";
    signals.push({
      id: signalId("referral_completion_drop", scope.county, scope.ward, null),
      kind: "referral_completion_drop",
      severity,
      county: scope.county,
      ward: scope.ward,
      tag: null,
      metric: {
        current: curRate,
        baseline: baseRate,
        delta: round1(curRate - baseRate),
        ratio: baseRate > 0 ? round1(curRate / baseRate) : null,
      },
      message: `Referral completion in ${place(scope.county, scope.ward)} fell to ${curRate}% this week (${curDone} of ${currentRows.length} referrals completed) from ${baseRate}% last week (${baseDone} of ${baselineRows.length}) — a ${drop}pp drop. Check the referral pipeline for where completions stall — this is an operational signal, not a diagnosis.`,
      investigationHint:
        "Open /referrals and check the pipeline for referrals awaiting acknowledgement or completion.",
    });
  }

  // 5) overdue_followup_growth — pending follow-ups overdue now vs overdue
  //    when the window opened, per (county, ward).
  interface OverdueBucket {
    county: string;
    ward: string | null;
    overdueNow: number;
    overdueAtWindowStart: number;
  }
  const overdueBuckets = new Map<string, OverdueBucket>();
  const overdueKey = (county: string, ward: string | null) =>
    `od:${county}::${ward ?? ""}`;
  for (const row of overduePending) {
    const county = row.triageRecord.county;
    const ward = row.triageRecord.ward;
    const key = overdueKey(county, ward);
    let entry = overdueBuckets.get(key);
    if (!entry) {
      entry = { county, ward, overdueNow: 0, overdueAtWindowStart: 0 };
      overdueBuckets.set(key, entry);
    }
    entry.overdueNow += 1;
    if (row.dueAt < currentStart) entry.overdueAtWindowStart += 1;
  }
  for (const entry of overdueBuckets.values()) {
    const growth = entry.overdueNow - entry.overdueAtWindowStart;
    if (growth < SIGNAL_THRESHOLDS.overdueGrowthMin) continue;
    const severity: SignalSeverity =
      growth >= SIGNAL_THRESHOLDS.overdueGrowthMin * 2 ? "alert" : "watch";
    const ratio =
      entry.overdueAtWindowStart > 0
        ? round1(entry.overdueNow / entry.overdueAtWindowStart)
        : null;
    signals.push({
      id: signalId("overdue_followup_growth", entry.county, entry.ward, null),
      kind: "overdue_followup_growth",
      severity,
      county: entry.county,
      ward: entry.ward,
      tag: null,
      metric: {
        current: entry.overdueNow,
        baseline: entry.overdueAtWindowStart,
        delta: growth,
        ratio,
      },
      message: `Overdue follow-ups in ${place(entry.county, entry.ward)} grew from ${entry.overdueAtWindowStart} at the start of the window to ${entry.overdueNow} now (Δ +${growth}). Review the overdue list oldest-first — this is an operational signal, not a diagnosis.`,
      investigationHint:
        "Open the pending follow-up panel on the home screen (/) and reschedule overdue visits oldest-first.",
    });
  }

  // --- Deterministic order + cap --------------------------------------------
  // alert > watch, then biggest delta first; ties broken by current count and
  // finally by id so the output is fully deterministic for identical data.
  signals.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.metric.delta - a.metric.delta ||
      b.metric.current - a.metric.current ||
      a.id.localeCompare(b.id)
  );

  return {
    generatedAt: now.toISOString(),
    window: {
      current: { start: currentStart.toISOString(), end: now.toISOString() },
      baseline: { start: baselineStart.toISOString(), end: currentStart.toISOString() },
    },
    signals: signals.slice(0, SIGNAL_THRESHOLDS.maxSignals),
    note: SIGNALS_NOTE,
  };
}
