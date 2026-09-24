import { db } from "@/lib/db";
import type { Classification, TriageRecordDTO } from "@/lib/types";
import type { TriageModelOutput } from "@/lib/types";

/**
 * Data-access layer. Mirrors the Supabase RLS design:
 *  - insertTriageRecord enforces submittedById ownership (the RLS
 *    auth.uid() = submitting user equivalent).
 *  - The dashboard aggregate functions NEVER select observed_indicators /
 *    chpNextAction / confidenceNote text — only counts. This is the
 *    "Postgres VIEW exposing only aggregated counts" equivalent, enforced
 *    at the data-access layer because SQLite has no native RLS.
 *  - The raw free-text observation is never persisted anywhere.
 */

export async function insertTriageRecord(args: {
  submittedById: string;
  county: string;
  ward?: string;
  output: TriageModelOutput;
  fallbackUsed: boolean;
}): Promise<TriageRecordDTO> {
  const { submittedById, county, ward, output, fallbackUsed } = args;
  const isCrisis = output.escalation === true;

  const created = await db.triageRecord.create({
    data: {
      submittedById,
      county,
      ward: ward ?? null,
      classification: isCrisis ? "needs_facility_referral" : output.classification,
      escalation: isCrisis,
      observedIndicators: JSON.stringify(
        isCrisis ? [] : output.observed_indicators
      ),
      aggregateTag: isCrisis ? "crisis_self_harm" : output.aggregate_tag ?? null,
      chpNextAction: isCrisis ? null : (isCrisis ? null : output.chp_next_action),
      chpInstruction: isCrisis ? output.chp_instruction : null,
      crisisLine: isCrisis ? output.crisis_line : null,
      confidenceNote: isCrisis
        ? "Crisis override triggered"
        : fallbackUsed
          ? output.confidence_note
          : (output.confidence_note ?? null),
    },
  });

  return toDTO(created, fallbackUsed);
}

function toDTO(
  row: {
    id: string;
    createdAt: Date;
    county: string;
    ward: string | null;
    classification: string;
    escalation: boolean;
    observedIndicators: string;
    aggregateTag: string | null;
    chpNextAction: string | null;
    chpInstruction: string | null;
    crisisLine: string | null;
    confidenceNote: string | null;
  },
  fallbackUsed: boolean
): TriageRecordDTO {
  let indicators: string[] = [];
  try {
    const parsed = JSON.parse(row.observedIndicators);
    if (Array.isArray(parsed)) indicators = parsed.filter((x) => typeof x === "string");
  } catch {
    indicators = [];
  }
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    county: row.county,
    ward: row.ward,
    classification: row.classification as Classification,
    escalation: row.escalation,
    observedIndicators: indicators,
    aggregateTag: row.aggregateTag,
    chpNextAction: row.chpNextAction,
    chpInstruction: row.chpInstruction,
    crisisLine: row.crisisLine,
    confidenceNote: row.confidenceNote,
    fallbackUsed,
  };
}

/**
 * Returns a CHV's own recent records (ownership-scoped — the RLS
 * `auth.uid() = submitted_by` equivalent). The CHV sees their own full
 * structured output (including observed_indicators, since they already
 * saw it at submission time). Other CHVs' records are never readable here.
 */
export async function getMyRecords(
  submittedById: string,
  limit = 20
): Promise<TriageRecordDTO[]> {
  const rows = await db.triageRecord.findMany({
    where: { submittedById },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => toDTO(r, false));
}

/** De-identified personal stats for a CHV's "my impact" card. */
export interface ChvStats {
  total: number;
  routine: number;
  needs_followup: number;
  needs_facility_referral: number;
  escalation: number;
  /** Last 7 days count (for a trend hint). */
  last7d: number;
  /** Previous 7 days count (for a delta). */
  prev7d: number;
  /** First submission date (ISO) — "since you joined". */
  firstSubmission: string | null;
  /** Distinct counties the CHV has submitted for (usually 1). */
  countiesCovered: number;
}

/**
 * Returns a CHV's personal aggregate stats (ownership-scoped). Computed from
 * their own records only — the RLS `auth.uid() = submitted_by` equivalent.
 */
export async function getMyStats(submittedById: string): Promise<ChvStats> {
  const now = new Date();
  const last7Start = new Date(now);
  last7Start.setDate(last7Start.getDate() - 7);
  last7Start.setHours(0, 0, 0, 0);
  const prev7Start = new Date(last7Start);
  prev7Start.setDate(prev7Start.getDate() - 7);

  const [groups, last7Rows, prev7Rows, firstRow, counties] = await Promise.all([
    db.triageRecord.groupBy({
      by: ["classification", "escalation"],
      _count: true,
      where: { submittedById },
    }),
    db.triageRecord.count({
      where: { submittedById, createdAt: { gte: last7Start } },
    }),
    db.triageRecord.count({
      where: {
        submittedById,
        createdAt: { gte: prev7Start, lt: last7Start },
      },
    }),
    db.triageRecord.findFirst({
      where: { submittedById },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    db.triageRecord.groupBy({
      by: ["county"],
      _count: true,
      where: { submittedById },
    }),
  ]);

  const stats: ChvStats = {
    total: 0,
    routine: 0,
    needs_followup: 0,
    needs_facility_referral: 0,
    escalation: 0,
    last7d: last7Rows,
    prev7d: prev7Rows,
    firstSubmission: firstRow ? firstRow.createdAt.toISOString() : null,
    countiesCovered: counties.length,
  };

  for (const g of groups) {
    stats.total += g._count;
    if (g.classification === "routine") stats.routine += g._count;
    if (g.classification === "needs_followup") stats.needs_followup += g._count;
    if (g.classification === "needs_facility_referral")
      stats.needs_facility_referral += g._count;
    if (g.escalation) stats.escalation += g._count;
  }

  return stats;
}

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

/**
 * Aggregate by county over the last `days` days. Uses groupBy — never touches
 * observed_indicators text.
 */
export async function getAggregateByCounty(
  days?: number
): Promise<CountyAggregate[]> {
  const since =
    days && days > 0
      ? (() => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() - (days - 1));
          return d;
        })()
      : undefined;
  const groups = await db.triageRecord.groupBy({
    by: ["county", "classification", "escalation"],
    _count: true,
    where: since ? { createdAt: { gte: since } } : undefined,
  });

  const byCounty = new Map<string, CountyAggregate>();
  const ensure = (county: string): CountyAggregate => {
    let a = byCounty.get(county);
    if (!a) {
      a = {
        county,
        routine: 0,
        needs_followup: 0,
        needs_facility_referral: 0,
        escalation: 0,
        total: 0,
      };
      byCounty.set(county, a);
    }
    return a;
  };

  for (const g of groups) {
    const a = ensure(g.county);
    a.total += g._count;
    if (g.classification === "routine") a.routine += g._count;
    if (g.classification === "needs_followup") a.needs_followup += g._count;
    if (g.classification === "needs_facility_referral") a.needs_facility_referral += g._count;
    if (g.escalation) a.escalation += g._count;
  }
  return Array.from(byCounty.values()).sort((a, b) => b.total - a.total);
}

/**
 * Aggregate by day (last N days). Group by date string.
 */
export async function getAggregateByDay(days = 14): Promise<DailyAggregate[]> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const rows = await db.triageRecord.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, classification: true, escalation: true },
  });

  const byDay = new Map<string, DailyAggregate>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, {
      day: key,
      routine: 0,
      needs_followup: 0,
      needs_facility_referral: 0,
      escalation: 0,
      total: 0,
    });
  }

  for (const r of rows) {
    const key = r.createdAt.toISOString().slice(0, 10);
    const a = byDay.get(key);
    if (!a) continue;
    a.total++;
    if (r.classification === "routine") a.routine++;
    if (r.classification === "needs_followup") a.needs_followup++;
    if (r.classification === "needs_facility_referral") a.needs_facility_referral++;
    if (r.escalation) a.escalation++;
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Aggregate by aggregate_tag (top signals) over the last `days` days. Never
 * exposes indicator text.
 */
export async function getAggregateByTag(
  limit = 12,
  days?: number
): Promise<TagAggregate[]> {
  const since =
    days && days > 0
      ? (() => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() - (days - 1));
          return d;
        })()
      : undefined;
  const groups = await db.triageRecord.groupBy({
    by: ["aggregateTag"],
    _count: true,
    orderBy: { _count: { aggregateTag: "desc" } },
    take: limit,
    where: since ? { createdAt: { gte: since } } : undefined,
  });
  return groups
    .filter((g) => g.aggregateTag)
    .map((g) => ({ aggregateTag: g.aggregateTag as string, count: g._count }));
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

export async function getDashboardStats(days = 14): Promise<DashboardStats> {
  const [byCounty, byDay, byTag, totalsGroups] = await Promise.all([
    getAggregateByCounty(days),
    getAggregateByDay(days),
    getAggregateByTag(12, days),
    db.triageRecord.groupBy({
      by: ["classification", "escalation"],
      _count: true,
      where:
        days > 0
          ? {
              createdAt: {
                gte: (() => {
                  const d = new Date();
                  d.setHours(0, 0, 0, 0);
                  d.setDate(d.getDate() - (days - 1));
                  return d;
                })(),
              },
            }
          : undefined,
    }),
  ]);

  const totals = {
    total: 0,
    routine: 0,
    needs_followup: 0,
    needs_facility_referral: 0,
    escalation: 0,
    countiesCovered: byCounty.length,
  };
  for (const g of totalsGroups) {
    totals.total += g._count;
    if (g.classification === "routine") totals.routine += g._count;
    if (g.classification === "needs_followup") totals.needs_followup += g._count;
    if (g.classification === "needs_facility_referral") totals.needs_facility_referral += g._count;
    if (g.escalation) totals.escalation += g._count;
  }

  return { byCounty, byDay, byTag, totals };
}

/* ------------------------------------------------------------------ */
/* Audit log — compliance layer.                                       */
/* Records WHO (actorId), WHEN, WHERE (county/ward), and the model's   */
/* verdict (classification/escalation/fallback) for every triage      */
/* event. NEVER stores the observation text or the redacted text.      */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  id: string;
  createdAt: string;
  triageRecordId: string | null;
  /** Truncated actor id (never the email) — enough for an activity feed. */
  actorLabel: string;
  event: string;
  county: string;
  ward: string | null;
  classification: string | null;
  escalation: boolean;
  fallbackUsed: boolean;
}

export async function writeAuditEntry(args: {
  triageRecordId?: string;
  actorId: string;
  event: string;
  county: string;
  ward?: string | null;
  classification?: string | null;
  escalation?: boolean;
  fallbackUsed?: boolean;
  piiRedactions?: Record<string, number> | null;
}): Promise<void> {
  await db.auditLog.create({
    data: {
      triageRecordId: args.triageRecordId ?? null,
      actorId: args.actorId,
      event: args.event,
      county: args.county,
      ward: args.ward ?? null,
      classification: args.classification ?? null,
      escalation: args.escalation ?? false,
      fallbackUsed: args.fallbackUsed ?? false,
      piiRedactions: args.piiRedactions
        ? JSON.stringify(args.piiRedactions)
        : null,
    },
  });
}

/** Recent audit entries for the dashboard activity strip (de-identified). */
export async function getRecentAudit(limit = 8): Promise<AuditEntry[]> {
  const rows = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      triageRecordId: true,
      actorId: true,
      event: true,
      county: true,
      ward: true,
      classification: true,
      escalation: true,
      fallbackUsed: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    triageRecordId: r.triageRecordId,
    // Truncated actor id — never the email. For the demo activity feed this
    // is enough to distinguish "chv A" vs "chv B" without identifying them.
    actorLabel: `chv·${r.actorId.slice(-4)}`,
    event: r.event,
    county: r.county,
    ward: r.ward,
    classification: r.classification,
    escalation: r.escalation,
    fallbackUsed: r.fallbackUsed,
  }));
}

/** Paginated audit entries for the compliance viewer page (de-identified). */
export async function getAuditPage(opts: {
  page?: number;
  pageSize?: number;
  county?: string;
  event?: string;
  escalationOnly?: boolean;
} = {}): Promise<{ entries: AuditEntry[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const where: { county?: string; event?: string; escalation?: boolean } = {};
  if (opts.county) where.county = opts.county;
  if (opts.event) where.event = opts.event;
  if (opts.escalationOnly) where.escalation = true;

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        triageRecordId: true,
        actorId: true,
        event: true,
        county: true,
        ward: true,
        classification: true,
        escalation: true,
        fallbackUsed: true,
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    entries: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      triageRecordId: r.triageRecordId,
      actorLabel: `chv·${r.actorId.slice(-4)}`,
      event: r.event,
      county: r.county,
      ward: r.ward,
      classification: r.classification,
      escalation: r.escalation,
      fallbackUsed: r.fallbackUsed,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * County-scoped dashboard stats — the RBAC path. When a county official is
 * logged in (or a CHV views their own county), we filter every aggregate to
 * a single county. The byCounty array then has at most one row; the daily
 * trend + tags are scoped to that county only.
 */
export async function getDashboardStatsForCounty(
  county: string,
  days = 14
): Promise<DashboardStats & { county: string }> {
  const since = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
  })();

  const where = {
    county,
    createdAt: { gte: since },
  };

  const [countyGroups, dayRows, tagGroups, totalsGroups] = await Promise.all([
    db.triageRecord.groupBy({
      by: ["county", "classification", "escalation"],
      _count: true,
      where,
    }),
    db.triageRecord.findMany({
      where,
      select: { createdAt: true, classification: true, escalation: true },
    }),
    db.triageRecord.groupBy({
      by: ["aggregateTag"],
      _count: true,
      orderBy: { _count: { aggregateTag: "desc" } },
      take: 12,
      where,
    }),
    db.triageRecord.groupBy({
      by: ["classification", "escalation"],
      _count: true,
      where,
    }),
  ]);

  // byCounty — single row for the scoped county
  const countyAgg: CountyAggregate = {
    county,
    routine: 0,
    needs_followup: 0,
    needs_facility_referral: 0,
    escalation: 0,
    total: 0,
  };
  for (const g of countyGroups) {
    countyAgg.total += g._count;
    if (g.classification === "routine") countyAgg.routine += g._count;
    if (g.classification === "needs_followup") countyAgg.needs_followup += g._count;
    if (g.classification === "needs_facility_referral")
      countyAgg.needs_facility_referral += g._count;
    if (g.escalation) countyAgg.escalation += g._count;
  }
  const byCounty = countyAgg.total > 0 ? [countyAgg] : [];

  // byDay — full N-day ladder, populated from dayRows
  const byDay = new Map<string, DailyAggregate>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, {
      day: key,
      routine: 0,
      needs_followup: 0,
      needs_facility_referral: 0,
      escalation: 0,
      total: 0,
    });
  }
  for (const r of dayRows) {
    const key = r.createdAt.toISOString().slice(0, 10);
    const a = byDay.get(key);
    if (!a) continue;
    a.total++;
    if (r.classification === "routine") a.routine++;
    if (r.classification === "needs_followup") a.needs_followup++;
    if (r.classification === "needs_facility_referral") a.needs_facility_referral++;
    if (r.escalation) a.escalation++;
  }

  const byTag: TagAggregate[] = tagGroups
    .filter((g) => g.aggregateTag)
    .map((g) => ({ aggregateTag: g.aggregateTag as string, count: g._count }));

  const totals = {
    total: 0,
    routine: 0,
    needs_followup: 0,
    needs_facility_referral: 0,
    escalation: 0,
    countiesCovered: byCounty.length,
  };
  for (const g of totalsGroups) {
    totals.total += g._count;
    if (g.classification === "routine") totals.routine += g._count;
    if (g.classification === "needs_followup") totals.needs_followup += g._count;
    if (g.classification === "needs_facility_referral")
      totals.needs_facility_referral += g._count;
    if (g.escalation) totals.escalation += g._count;
  }

  return { byCounty, byDay, byTag, totals, county };
}
