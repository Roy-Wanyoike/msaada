import { db } from "@/lib/db";

/**
 * Community Report analytics + audit (CR-014).
 *
 * These helpers write AuditLog entries for every meaningful lifecycle event
 * on a CommunityReport / ResponseCase, and expose de-identified aggregate
 * stats for the management-intelligence dashboard (CR-015).
 *
 * DE-IDENTIFICATION (CR-014 §14): the audit log NEVER stores the raw concern
 * text, the PII-scrubbed description, the AI interpretation JSON, or any
 * resolution note. Only the event type, county/ward, the AI classification
 * verdict, the deterministic policy escalation flag, the policy version, and
 * (optionally) a referral id are persisted. This mirrors the existing
 * `writeAuditEntry()` contract on the triage side.
 *
 * NON-FATAL: audit writes must never break the user-facing flow. Every write
 * is wrapped in try/catch; failures are logged to the server console but never
 * re-thrown. The audit log is a compliance side-channel, not a transactional
 * requirement.
 */

// ---- Event vocabulary (CR-014) -------------------------------------------
// One canonical list so callers cannot drift. The strings are persisted
// verbatim in `AuditLog.event`, so changing them is a schema migration.
export const COMMUNITY_REPORT_EVENTS = [
  "community_report_created",     // a concern was submitted
  "community_report_triaged",     // AI processed the report
  "community_response_created",   // a ResponseCase was opened from a report
  "community_response_assigned",  // a CHV was assigned (deterministic policy)
  "community_response_accepted",  // the CHV accepted the assignment
  "community_response_started",   // the CHV began the response (MVP-44)
  "community_response_attended",  // the CHV marked attendance (encounter link)
  "community_response_resolved",  // the case reached a resolution
  "community_response_unable_to_reach", // the CHV could not reach the subject (MVP-44)
] as const;

export type CommunityReportEvent = (typeof COMMUNITY_REPORT_EVENTS)[number];

export interface WriteCommunityReportAuditArgs {
  /** Who triggered the event. Required by the AuditLog schema. Use the
   *  reporter/CHV id when known; fall back to "system" for autonomous
   *  policy/AI steps. Never the email. */
  actorId: string;
  /** One of COMMUNITY_REPORT_EVENTS. */
  event: CommunityReportEvent | string;
  /** From the CommunityReport.county. Required. */
  county: string;
  /** From the CommunityReport.ward. */
  ward?: string | null;
  /** From the AI interpretation (the verdict, never the raw text). */
  classification?: string | null;
  /** From the deterministic policy decision (escalation flag). */
  escalation?: boolean;
  /** The policy engine version that produced the escalation flag. */
  policyVersion?: string | null;
  /** Referral created from this report's response case, if any. */
  referralId?: string | null;
  /** Acting user's organization (MVP-44) — from the session when available. */
  organizationId?: string | null;
  /** Acting user's authorization role (MVP-44) — from the session when available. */
  authorizationRole?: string | null;
}

/**
 * Write a single AuditLog row for a community-report lifecycle event.
 *
 * NON-FATAL: any DB error is caught and logged. The caller's transaction
 * (the actual report/case mutation) is unaffected.
 */
export async function writeCommunityReportAudit(
  args: WriteCommunityReportAuditArgs
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        // No triageRecordId — these events are for the community-report
        // lifecycle, not the triage lifecycle. The AuditLog schema leaves
        // triageRecordId nullable for exactly this kind of cross-cutting
        // event.
        triageRecordId: null,
        actorId: args.actorId,
        event: args.event,
        county: args.county,
        ward: args.ward ?? null,
        // ONLY the verdict — never the concern text, AI interpretation JSON,
        // or resolution note (CR-014 §14).
        classification: args.classification ?? null,
        escalation: args.escalation ?? false,
        // fallbackUsed is a triage-side concept; not applicable here.
        fallbackUsed: false,
        piiRedactions: null,
        policyVersion: args.policyVersion ?? null,
        // The deterministic workflow class (routine|follow_up_required|
        // referral_required|crisis_override) belongs on the report itself;
        // the audit log only records the event + escalation flag.
        workflowClass: null,
        referralId: args.referralId ?? null,
        organizationId: args.organizationId ?? null,
        authorizationRole: args.authorizationRole ?? null,
      },
    });
  } catch (err) {
    // Non-fatal: log and continue. The audit log is a compliance side-channel
    // and must never break the user-facing flow.
    console.error("[community-report-audit] write failed", {
      event: args.event,
      county: args.county,
      actorId: args.actorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---- Aggregate stats (CR-015) -------------------------------------------
// De-identified — counts only. Never selects description, aiInterpretation,
// policyDecision JSON, or resolutionNote text. This is the "Postgres VIEW
// exposing only aggregate counts" equivalent for the community-reporting
// subsystem, enforced at the data-access boundary.

export interface CommunityReportStats {
  /** Total community reports in scope. */
  totalReports: number;
  /** Reports grouped by lifecycle status. */
  byStatus: Array<{ status: string; count: number }>;
  /** Reports grouped by category (mental_health, maternal, etc.). */
  byCategory: Array<{ category: string; count: number }>;
  /** Total response cases derived from the reports in scope. */
  totalCases: number;
  /** Cases grouped by lifecycle status. */
  casesByStatus: Array<{ status: string; count: number }>;
  /** Fraction of reports that produced at least one response case. */
  responseRate: number;
  /** Mean (ms) from case creation → CHV assignment, over assigned cases. */
  meanAssignmentTimeMs: number | null;
  /** Fraction of cases that reached a terminal resolution (resolved or
   *  unable_to_reach). */
  resolutionRate: number;
}

export interface CommunityReportStatsOpts {
  /** Optional county filter (RBAC scope). */
  county?: string;
  /** Optional category filter. */
  category?: string;
  /** Optional window in days (createdAt >= now - days). 0 = all time. */
  days?: number;
}

/**
 * Aggregate community-reporting stats for the management-intelligence UI.
 *
 * De-identified by construction: the queries use `groupBy` + `_count` only,
 * never selecting description / aiInterpretation / resolutionNote. Returns
 * counts and derived rates.
 *
 * NON-FATAL: if any sub-query fails, the helper returns a zeroed stats object
 * rather than throwing — the dashboard must always render.
 */
export async function getCommunityReportStats(
  opts: CommunityReportStatsOpts = {}
): Promise<CommunityReportStats> {
  const where = {
    ...(opts.county ? { county: opts.county } : {}),
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.days && opts.days > 0
      ? {
          createdAt: {
            gte: (() => {
              const d = new Date();
              d.setHours(0, 0, 0, 0);
              d.setDate(d.getDate() - (opts.days! - 1));
              return d;
            })(),
          },
        }
      : {}),
  };

  const empty: CommunityReportStats = {
    totalReports: 0,
    byStatus: [],
    byCategory: [],
    totalCases: 0,
    casesByStatus: [],
    responseRate: 0,
    meanAssignmentTimeMs: null,
    resolutionRate: 0,
  };

  try {
    const [totalReports, byStatus, byCategory, caseStatusGroups, caseAssigned] =
      await Promise.all([
        db.communityReport.count({ where }),
        db.communityReport.groupBy({
          by: ["status"],
          _count: true,
          where,
        }),
        db.communityReport.groupBy({
          by: ["category"],
          _count: true,
          where,
        }),
        // Cases inherit scope from their parent report.
        db.responseCase.groupBy({
          by: ["status"],
          _count: true,
          where: opts.county
            ? { report: { county: opts.county } }
            : opts.days && opts.days > 0
              ? {
                  report: {
                    createdAt: where.createdAt,
                  },
                }
              : undefined,
        }),
        // For the response-rate numerator: reports that have at least one
        // case. Cheaper to count distinct reportId on the cases table than
        // to N+1 across reports.
        db.responseCase.findMany({
          where: opts.county
            ? { report: { county: opts.county } }
            : opts.days && opts.days > 0
              ? { report: { createdAt: where.createdAt } }
              : undefined,
          select: { reportId: true, assignedAt: true, createdAt: true },
        }),
      ]);

    const totalCases = caseStatusGroups.reduce((s, g) => s + g._count, 0);

    // Distinct reports that have at least one case.
    const reportIdsWithCases = new Set(caseAssigned.map((c) => c.reportId));
    const responseRate = totalReports > 0
      ? reportIdsWithCases.size / totalReports
      : 0;

    // Mean assignment time: createdAt → assignedAt, only for assigned cases.
    const assignedCases = caseAssigned.filter((c) => c.assignedAt);
    const meanAssignmentTimeMs =
      assignedCases.length > 0
        ? assignedCases.reduce((sum, c) => {
            const dt = c.assignedAt!.getTime() - c.createdAt.getTime();
            return sum + Math.max(0, dt);
          }, 0) / assignedCases.length
        : null;

    // Resolution rate: cases in a terminal state over total cases.
    const resolvedCount = caseStatusGroups
      .filter((g) => g.status === "resolved" || g.status === "unable_to_reach")
      .reduce((s, g) => s + g._count, 0);
    const resolutionRate = totalCases > 0 ? resolvedCount / totalCases : 0;

    return {
      totalReports,
      byStatus: byStatus.map((g) => ({ status: g.status, count: g._count })),
      byCategory: byCategory.map((g) => ({ category: g.category, count: g._count })),
      totalCases,
      casesByStatus: caseStatusGroups.map((g) => ({
        status: g.status,
        count: g._count,
      })),
      responseRate,
      meanAssignmentTimeMs,
      resolutionRate,
    };
  } catch (err) {
    console.error("[community-report-audit] stats failed", {
      county: opts.county,
      category: opts.category,
      days: opts.days,
      error: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}
