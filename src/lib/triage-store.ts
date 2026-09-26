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
  /** Links to the Encounter that generated this observation (section 6, 15). */
  encounterId?: string;
  /** AI transparency: model id (or "fallback") and prompt version used. */
  aiModel?: string;
  promptVersion?: string;
}): Promise<TriageRecordDTO> {
  const { submittedById, county, ward, output, fallbackUsed, encounterId, aiModel, promptVersion } = args;
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
      chpNextAction: isCrisis ? null : output.chp_next_action,
      fallbackUsed,
      encounterId: encounterId ?? null,
      aiModel: aiModel ?? null,
      promptVersion: promptVersion ?? null,
      aiReasoning: isCrisis ? null : output.reasoning ?? null,
      chpNextActionSw: isCrisis ? null : output.chp_next_action_sw ?? null,
      chpInstruction: isCrisis ? output.chp_instruction : null,
      crisisLine: isCrisis ? output.crisis_line : null,
      confidenceNote: isCrisis
        ? // Issue #45: when the crisis verdict was forced by the keyword
          // screen (model-success override), the output carries a provenance
          // note — persist it; otherwise the default crisis label stands.
          (output.confidence_note ?? "Crisis override triggered")
        : fallbackUsed
          ? output.confidence_note
          : (output.confidence_note ?? null),
    },
  });

  return toDTO(created);
}

function toDTO(
  row: {
    id: string;
    createdAt: Date;
    county: string;
    ward: string | null;
    classification: string;
    escalation: boolean;
    fallbackUsed: boolean;
    observedIndicators: string;
    aggregateTag: string | null;
    chpNextAction: string | null;
    chpInstruction: string | null;
    crisisLine: string | null;
    confidenceNote: string | null;
    encounterId: string | null;
    aiReasoning?: string | null;
    chpNextActionSw?: string | null;
    aiModel?: string | null;
    promptVersion?: string | null;
  }
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
    fallbackUsed: row.fallbackUsed,
    encounterId: row.encounterId,
    aiReasoning: row.aiReasoning ?? null,
    chpNextActionSw: row.chpNextActionSw ?? null,
    aiModel: row.aiModel ?? null,
    promptVersion: row.promptVersion ?? null,
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
  return rows.map((r) => toDTO(r));
}

/* ------------------------------------------------------------------ */
/* Follow-up tracking — operational workflow layer.                    */
/* When a triage produces needs_followup or needs_facility_referral,   */
/* a FollowUp row is created (due in 48h per the spec). The CHV can    */
/* mark it done/missed. Ownership-scoped — a CHV sees only their own.  */
/* ------------------------------------------------------------------ */

export type FollowUpStatus = "pending" | "done" | "missed";

export interface FollowUpDTO {
  id: string;
  createdAt: string;
  dueAt: string;
  status: FollowUpStatus;
  resolvedAt: string | null;
  resolutionNote: string | null;
  triageRecordId: string;
  chvId: string;
  /** Denormalized from the TriageRecord for the UI (avoids a second fetch). */
  county: string;
  ward: string | null;
  classification: Classification;
  escalation: boolean;
  aggregateTag: string | null;
  chpNextAction: string | null;
}

function toFollowUpDTO(r: {
  id: string;
  createdAt: Date;
  dueAt: Date;
  status: string;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  triageRecordId: string;
  chvId: string;
  triageRecord: {
    county: string;
    ward: string | null;
    classification: string;
    escalation: boolean;
    aggregateTag: string | null;
    chpNextAction: string | null;
  } | null;
}): FollowUpDTO {
  const t = r.triageRecord;
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    dueAt: r.dueAt.toISOString(),
    status: (["pending", "done", "missed"].includes(r.status) ? r.status : "pending") as FollowUpStatus,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    resolutionNote: r.resolutionNote,
    triageRecordId: r.triageRecordId,
    chvId: r.chvId,
    county: t?.county ?? "—",
    ward: t?.ward ?? null,
    classification: (t?.classification ?? "needs_followup") as Classification,
    escalation: t?.escalation ?? false,
    aggregateTag: t?.aggregateTag ?? null,
    chpNextAction: t?.chpNextAction ?? null,
  };
}

/**
 * Create a follow-up for a triage record (called by /api/triage when the
 * classification is needs_followup or needs_facility_referral). Due in 48h.
 * Idempotent — if an open follow-up already exists for this triage record,
 * returns the existing one instead of creating a duplicate.
 */
export async function createFollowUp(args: {
  triageRecordId: string;
  chvId: string;
  dueInHours?: number;
  /** Links to the Referral that generated this follow-up (section 14). */
  referralId?: string;
}): Promise<FollowUpDTO | null> {
  const dueInHours = args.dueInHours ?? 48;
  // Idempotent: check for an existing pending follow-up for this record.
  const existing = await db.followUp.findFirst({
    where: { triageRecordId: args.triageRecordId, status: "pending" },
    include: { triageRecord: { select: { county: true, ward: true, classification: true, escalation: true, aggregateTag: true, chpNextAction: true } } },
  });
  if (existing) return toFollowUpDTO(existing);

  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + dueInHours);

  const created = await db.followUp.create({
    data: {
      triageRecordId: args.triageRecordId,
      chvId: args.chvId,
      dueAt,
      referralId: args.referralId ?? null,
    },
    include: { triageRecord: { select: { county: true, ward: true, classification: true, escalation: true, aggregateTag: true, chpNextAction: true } } },
  });
  return toFollowUpDTO(created);
}

/** Returns a CHV's follow-ups (ownership-scoped). Default: pending only. */
export async function getMyFollowUps(
  chvId: string,
  opts: { status?: FollowUpStatus | "all"; limit?: number } = {}
): Promise<FollowUpDTO[]> {
  const status = opts.status ?? "pending";
  const rows = await db.followUp.findMany({
    where: {
      chvId,
      ...(status !== "all" ? { status } : {}),
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: opts.limit ?? 50,
    include: {
      triageRecord: { select: { county: true, ward: true, classification: true, escalation: true, aggregateTag: true, chpNextAction: true } },
    },
  });
  return rows.map(toFollowUpDTO);
}

/** Resolve a follow-up (mark done/missed). Ownership-scoped. */
export async function resolveFollowUp(args: {
  followUpId: string;
  chvId: string;
  status: "done" | "missed";
  resolutionNote?: string;
}): Promise<FollowUpDTO | null> {
  const { followUpId, chvId, status, resolutionNote } = args;
  // Ownership check: only the assigned CHV can resolve.
  const existing = await db.followUp.findUnique({ where: { id: followUpId } });
  if (!existing || existing.chvId !== chvId) return null;
  if (existing.status !== "pending") return null; // already resolved

  const updated = await db.followUp.update({
    where: { id: followUpId },
    data: {
      status,
      resolvedAt: new Date(),
      resolutionNote: resolutionNote?.trim() || null,
    },
    include: {
      triageRecord: { select: { county: true, ward: true, classification: true, escalation: true, aggregateTag: true, chpNextAction: true } },
    },
  });
  return toFollowUpDTO(updated);
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

/**
 * YYYY-MM-DD in the server's local time zone. Day ladders start at local
 * midnight, so their keys must be local too: keying by UTC shifts every
 * bucket back a day east of UTC (EAT is +3) and drops today's records.
 */
function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
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
    const key = localDayKey(d);
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
    const key = localDayKey(r.createdAt);
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
  /** AI-transparency columns (null on legacy rows / non-AI events). */
  policyVersion: string | null;
  aiModel: string | null;
  workflowClass: string | null;
}

/**
 * De-identified actor label for audit rows. Public (unauthenticated) report
 * submissions use actorId "public" — those render as "public·report" instead
 * of the chv·xxxx truncation (which would leak a meaningless "chv·blic").
 */
function actorLabelFor(actorId: string): string {
  return actorId === "public" ? "public·report" : `chv·${actorId.slice(-4)}`;
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
  /** Policy engine version + workflow classification (section 12, 21). */
  policyVersion?: string;
  /** Model id that produced the verdict, or "fallback". */
  aiModel?: string;
  workflowClass?: string;
  referralId?: string | null;
  /** Acting user's organization (MVP-44) — from the session when available. */
  organizationId?: string | null;
  /** Acting user's authorization role (MVP-44) — from the session when available. */
  authorizationRole?: string | null;
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
      policyVersion: args.policyVersion ?? null,
      aiModel: args.aiModel ?? null,
      workflowClass: args.workflowClass ?? null,
      referralId: args.referralId ?? null,
      organizationId: args.organizationId ?? null,
      authorizationRole: args.authorizationRole ?? null,
    },
  });
}

/**
 * Recent audit entries for the dashboard activity strip (de-identified).
 * Optional `county` filters by county — used on the `?scope=mine` RBAC
 * path so a county official doesn't see audit entries from other counties.
 */
export async function getRecentAudit(
  limit = 8,
  county?: string
): Promise<AuditEntry[]> {
  const rows = await db.auditLog.findMany({
    where: county ? { county } : undefined,
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
      policyVersion: true,
      aiModel: true,
      workflowClass: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    triageRecordId: r.triageRecordId,
    // Truncated actor id — never the email. For the demo activity feed this
    // is enough to distinguish "chv A" vs "chv B" without identifying them.
    actorLabel: actorLabelFor(r.actorId),
    event: r.event,
    county: r.county,
    ward: r.ward,
    classification: r.classification,
    escalation: r.escalation,
    fallbackUsed: r.fallbackUsed,
    policyVersion: r.policyVersion,
    aiModel: r.aiModel,
    workflowClass: r.workflowClass,
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
        policyVersion: true,
        aiModel: true,
        workflowClass: true,
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    entries: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      triageRecordId: r.triageRecordId,
      actorLabel: actorLabelFor(r.actorId),
      event: r.event,
      county: r.county,
      ward: r.ward,
      classification: r.classification,
      escalation: r.escalation,
      fallbackUsed: r.fallbackUsed,
      policyVersion: r.policyVersion,
      aiModel: r.aiModel,
      workflowClass: r.workflowClass,
    })),
    total,
    page,
    pageSize,
  };
}

/* ------------------------------------------------------------------ */
/* Follow-up completion stats — for dashboard/supervisor metrics.      */
/* ------------------------------------------------------------------ */

export interface FollowUpStats {
  pending: number;
  done: number;
  missed: number;
  /** Overdue = pending AND past dueAt. */
  overdue: number;
  /** Completion rate = done / (done + missed). 0 if none resolved. */
  completionRate: number;
  total: number;
}

/**
 * Returns aggregate follow-up stats (de-identified — counts only). Optionally
 * filtered by county and/or a date window. Used by the dashboard's follow-up
 * KPI card and the supervisor roster.
 */
export async function getFollowUpStats(
  opts: { county?: string; days?: number } = {}
): Promise<FollowUpStats> {
  const since = opts.days
    ? (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - (opts.days! - 1));
        return d;
      })()
    : undefined;

  // County filter requires joining through TriageRecord — use the relation.
  const where = {
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(opts.county ? { triageRecord: { county: opts.county } } : {}),
  };

  const [statusGroups, overdueCount, total] = await Promise.all([
    db.followUp.groupBy({
      by: ["status"],
      _count: true,
      where,
    }),
    db.followUp.count({
      where: {
        ...where,
        status: "pending",
        dueAt: { lt: new Date() },
      },
    }),
    db.followUp.count({ where }),
  ]);

  const stats: FollowUpStats = {
    pending: 0,
    done: 0,
    missed: 0,
    overdue: overdueCount,
    total,
    completionRate: 0,
  };
  for (const g of statusGroups) {
    if (g.status === "pending") stats.pending = g._count;
    if (g.status === "done") stats.done = g._count;
    if (g.status === "missed") stats.missed = g._count;
  }
  const resolved = stats.done + stats.missed;
  stats.completionRate = resolved > 0 ? Math.round((stats.done / resolved) * 100) : 0;
  return stats;
}

/* ------------------------------------------------------------------ */
/* Supervisor roster — de-identified per-CHV aggregate for supervisors. */
/* Groups triage records by submitting CHV, returning per-CHV counts    */
/* (never the CHV email, never observation text). A supervisor sees     */
/* activity + load + escalation burden per volunteer.                   */
/* ------------------------------------------------------------------ */

export interface SupervisorChvRow {
  /** Truncated CHV id — never the email. */
  chvLabel: string;
  county: string;
  ward: string | null;
  total: number;
  routine: number;
  needs_followup: number;
  needs_facility_referral: number;
  escalation: number;
  /** Last 7 days count (for activity recency). */
  last7d: number;
  /** Most recent submission (ISO) — null if none. */
  lastSubmission: string | null;
}

export interface SupervisorRoster {
  rows: SupervisorChvRow[];
  totals: {
    chvs: number;
    total: number;
    escalations: number;
  };
}

/**
 * Returns a de-identified per-CHV roster for the supervisor view. Groups
 * triage records by submittedById, computes per-CHV aggregates, and labels
 * each row with a truncated id (chv·xxxx) — never the email. Optionally
 * filter by county. Ownership is NOT bypassed at the row level (the
 * supervisor sees aggregates only, never individual observation text).
 *
 * TODO (production): require a supervisor RBAC role. Currently open for demo.
 */
export async function getSupervisorRoster(
  county?: string,
  days = 14
): Promise<SupervisorRoster> {
  const since = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
  })();
  const last7Start = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 7);
    return d;
  })();

  const where = {
    createdAt: { gte: since },
    ...(county ? { county } : {}),
  };

  // Group by submittedById + classification + escalation for per-CHV breakdowns.
  const [groups, chvs, last7Counts, lastSubs] = await Promise.all([
    db.triageRecord.groupBy({
      by: ["submittedById", "classification", "escalation"],
      _count: true,
      where,
    }),
    db.chvUser.findMany({
      where: county ? { county } : undefined,
      select: { id: true, county: true, ward: true },
    }),
    db.triageRecord.groupBy({
      by: ["submittedById"],
      _count: true,
      where: { ...where, createdAt: { gte: last7Start } },
    }),
    db.triageRecord.findMany({
      where,
      distinct: ["submittedById"],
      orderBy: { createdAt: "desc" },
      select: { submittedById: true, createdAt: true },
    }),
  ]);

  const chvMeta = new Map(chvs.map((c) => [c.id, c]));
  const last7Map = new Map(last7Counts.map((g) => [g.submittedById, g._count]));
  const lastSubMap = new Map(lastSubs.map((r) => [r.submittedById, r.createdAt.toISOString()]));

  const byChv = new Map<string, SupervisorChvRow>();
  const ensure = (id: string): SupervisorChvRow => {
    let r = byChv.get(id);
    if (!r) {
      const meta = chvMeta.get(id);
      r = {
        chvLabel: `chv·${id.slice(-4)}`,
        county: meta?.county ?? "—",
        ward: meta?.ward ?? null,
        total: 0,
        routine: 0,
        needs_followup: 0,
        needs_facility_referral: 0,
        escalation: 0,
        last7d: last7Map.get(id) ?? 0,
        lastSubmission: lastSubMap.get(id) ?? null,
      };
      byChv.set(id, r);
    }
    return r;
  };

  let totalAll = 0;
  let totalEsc = 0;
  for (const g of groups) {
    const r = ensure(g.submittedById);
    r.total += g._count;
    totalAll += g._count;
    if (g.classification === "routine") r.routine += g._count;
    if (g.classification === "needs_followup") r.needs_followup += g._count;
    if (g.classification === "needs_facility_referral") r.needs_facility_referral += g._count;
    if (g.escalation) {
      r.escalation += g._count;
      totalEsc += g._count;
    }
  }

  const rows = Array.from(byChv.values()).sort((a, b) => b.total - a.total);

  return {
    rows,
    totals: { chvs: rows.length, total: totalAll, escalations: totalEsc },
  };
}

/* ------------------------------------------------------------------ */
/* Supervisor command-center ops — pending work, overdue referrals,    */
/* and data-quality signals (MVP-44). Aggregate + de-identified:       */
/* counts and stable codes only — never household addresses, member    */
/* names, or observation text.                                         */
/* ------------------------------------------------------------------ */

export interface OverdueReferralItem {
  referralCode: string;
  status: string;
  category: string;
  priority: string;
  /** Whole hours since the referral was acknowledged (its state clock). */
  ageHours: number;
}

export interface SupervisorOps {
  /** Acknowledged/in_progress referrals whose state clock is >48h old. */
  overdueReferrals: {
    count: number;
    /** Oldest first, capped — a summary, not the full worklist. */
    items: OverdueReferralItem[];
  };
  /** Work waiting on someone: pending follow-ups + created/sent referrals. */
  pendingWork: {
    pendingFollowUps: number;
    overdueFollowUps: number;
    referralsAwaitingAcknowledgement: number;
  };
  /** Data-quality signals (counts + de-identified labels only). */
  dataQuality: {
    /** Encounters (last 7d) whose triage stored an empty indicator list. */
    emptyIndicatorEncounters7d: number;
    /** CHVs with zero encounters in the last 14 days. */
    chvsWithZeroEncounters14d: {
      count: number;
      labels: string[];
    };
    /** Follow-ups marked missed (all time in scope). */
    missedFollowUps: number;
  };
}

/**
 * Aggregate operational signals for the supervisor command center. Additive
 * to getSupervisorRoster (the roster API merges both responses). Every query
 * is count/list-of-codes scoped; when `county` is given, referrals and
 * encounters filter through their household's county and follow-ups through
 * the triage record's county.
 */
export async function getSupervisorOps(county?: string): Promise<SupervisorOps> {
  const now = Date.now();
  const overdueCutoff = new Date(now - 48 * 3600_000);
  const daysAgoStart = (days: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
  };
  const last7d = daysAgoStart(7);
  const last14d = daysAgoStart(14);

  // County scoping per table: Referral/Encounter reach county through the
  // household; FollowUp/TriageRecord carry it directly (via the record).
  const referralWhere = county
    ? { encounter: { household: { county } } }
    : {};
  const followUpWhere = county ? { triageRecord: { county } } : {};
  const encounterWhere = county ? { household: { county } } : {};

  const [
    overdueRows,
    overdueCount,
    awaitingAck,
    pendingFollowUps,
    overdueFollowUps,
    missedFollowUps,
    emptyIndicatorRows,
    chvs,
    encounterGroups,
  ] = await Promise.all([
    // Overdue = acknowledged/in_progress AND stuck >48h since acknowledgement
    // (both states require acknowledgement, so acknowledgedAt is the state
    // clock). List is capped and sorted oldest-first.
    db.referral.findMany({
      where: {
        ...referralWhere,
        status: { in: ["acknowledged", "in_progress"] },
        acknowledgedAt: { lt: overdueCutoff },
      },
      orderBy: { acknowledgedAt: "asc" },
      take: 5,
      select: {
        referralCode: true,
        status: true,
        category: true,
        priority: true,
        acknowledgedAt: true,
      },
    }),
    db.referral.count({
      where: {
        ...referralWhere,
        status: { in: ["acknowledged", "in_progress"] },
        acknowledgedAt: { lt: overdueCutoff },
      },
    }),
    // Created/sent referrals awaiting acknowledgement.
    db.referral.count({
      where: {
        ...referralWhere,
        status: { in: ["created", "sent"] },
      },
    }),
    db.followUp.count({ where: { ...followUpWhere, status: "pending" } }),
    db.followUp.count({
      where: { ...followUpWhere, status: "pending", dueAt: { lt: new Date() } },
    }),
    db.followUp.count({ where: { ...followUpWhere, status: "missed" } }),
    // Empty-indicator triage records in the last 7 days (data-quality:
    // the structured output came back with nothing observable). SQLite
    // stores the JSON array as TEXT — "[]" (or "" on malformed legacy rows).
    db.triageRecord.count({
      where: {
        ...(county ? { county } : {}),
        createdAt: { gte: last7d },
        observedIndicators: { in: ["[]", ""] },
      },
    }),
    db.chvUser.findMany({
      where: county ? { county } : undefined,
      select: { id: true },
    }),
    db.encounter.groupBy({
      by: ["chwId"],
      _count: true,
      where: { ...encounterWhere, createdAt: { gte: last14d } },
    }),
  ]);

  const activeChvIds = new Set(encounterGroups.map((g) => g.chwId));
  const idleChvLabels = chvs
    .filter((c) => !activeChvIds.has(c.id))
    .map((c) => `chv·${c.id.slice(-4)}`);

  return {
    overdueReferrals: {
      count: overdueCount,
      items: overdueRows.map((r) => ({
        referralCode: r.referralCode,
        status: r.status,
        category: r.category,
        priority: r.priority,
        ageHours: r.acknowledgedAt
          ? Math.max(0, Math.floor((now - r.acknowledgedAt.getTime()) / 3600_000))
          : 0,
      })),
    },
    pendingWork: {
      pendingFollowUps,
      overdueFollowUps,
      referralsAwaitingAcknowledgement: awaitingAck,
    },
    dataQuality: {
      emptyIndicatorEncounters7d: emptyIndicatorRows,
      chvsWithZeroEncounters14d: {
        count: idleChvLabels.length,
        labels: idleChvLabels.slice(0, 12),
      },
      missedFollowUps,
    },
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
    const key = localDayKey(d);
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
    const key = localDayKey(r.createdAt);
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

  // byDay was built as a Map keyed by date (insertion order = oldest → newest);
  // the DashboardStats contract is an array.
  return { byCounty, byDay: Array.from(byDay.values()), byTag, totals, county };
}
