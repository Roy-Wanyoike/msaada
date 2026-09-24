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
 * Aggregate by county. Uses groupBy — never touches observed_indicators text.
 */
export async function getAggregateByCounty(): Promise<CountyAggregate[]> {
  const groups = await db.triageRecord.groupBy({
    by: ["county", "classification", "escalation"],
    _count: true,
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
 * Aggregate by aggregate_tag (top signals). Never exposes indicator text.
 */
export async function getAggregateByTag(limit = 12): Promise<TagAggregate[]> {
  const groups = await db.triageRecord.groupBy({
    by: ["aggregateTag"],
    _count: true,
    orderBy: { _count: { aggregateTag: "desc" } },
    take: limit,
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

export async function getDashboardStats(): Promise<DashboardStats> {
  const [byCounty, byDay, byTag, totalsGroups] = await Promise.all([
    getAggregateByCounty(),
    getAggregateByDay(14),
    getAggregateByTag(12),
    db.triageRecord.groupBy({
      by: ["classification", "escalation"],
      _count: true,
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
