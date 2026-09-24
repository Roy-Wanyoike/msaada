import { db } from "@/lib/db";
import { generateCode } from "@/lib/identity-types";
import type { CommunityReportDTO, ResponseCaseDTO } from "@/lib/community-report-types";

/**
 * Data-access for Community Reports + Response Cases (CR-001 through CR-010).
 * Reuses the existing `generateCode` from identity-types (no duplication).
 * The raw concern text is PII-scrubbed BEFORE persistence (de-identification
 * invariant maintained — the scrubbed text IS the "raw fact").
 */

// ---- CommunityReport CRUD ----

export async function createReport(args: {
  reporterName?: string;
  reporterContact?: string;
  reporterType?: string;
  assistedById?: string;
  subjectType?: string;
  subjectPersonId?: string;
  subjectHouseholdId?: string;
  description: string; // ALREADY PII-scrubbed by the caller
  category?: string;
  county: string;
  ward?: string;
  landmark?: string;
  directions?: string;
  channel?: string;
  idempotencyKey?: string;
}): Promise<CommunityReportDTO> {
  // Idempotency: if a report with this key exists, return it.
  if (args.idempotencyKey) {
    const existing = await db.communityReport.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
    });
    if (existing) return toReportDTO(existing, 0);
  }

  const created = await db.communityReport.create({
    data: {
      reportCode: generateCode("MSD-RPT"),
      reporterName: args.reporterName ?? null,
      reporterContact: args.reporterContact ?? null,
      reporterType: args.reporterType ?? "self",
      assistedById: args.assistedById ?? null,
      subjectType: args.subjectType ?? "unidentified_person",
      subjectPersonId: args.subjectPersonId ?? null,
      subjectHouseholdId: args.subjectHouseholdId ?? null,
      description: args.description,
      category: args.category ?? "mental_health",
      county: args.county,
      ward: args.ward ?? null,
      landmark: args.landmark ?? null,
      directions: args.directions ?? null,
      channel: args.channel ?? "web",
      status: "received",
      idempotencyKey: args.idempotencyKey ?? null,
    },
  });
  return toReportDTO(created, 0);
}

export async function getReport(id: string): Promise<CommunityReportDTO | null> {
  const row = await db.communityReport.findUnique({ where: { id } });
  if (!row) return null;
  const caseCount = await db.responseCase.count({ where: { reportId: id } });
  return toReportDTO(row, caseCount);
}

/**
 * List community reports. The `county` filter is the county-RLS-equivalent
 * scoping lever (issue #13): the caller (the API route) MUST pass the
 * session CHV's county for non-admin roles so a CHV in Kilifi cannot ask
 * for Nairobi data. The store does NOT read the session itself — it trusts
 * whatever the caller passes — so the route is the trust boundary and the
 * route is responsible for forcing `county = chv.county` for non-admin
 * roles and ignoring any client-supplied query-string `county` for those
 * roles. Admin roles may pass any county (or omit it for all-county).
 *
 * `limit`/`offset` paginate; `status`/`category` are optional filters.
 */
export async function getReports(opts: {
  status?: string;
  county?: string;
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<{ reports: CommunityReportDTO[]; total: number }> {
  const where = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.county ? { county: opts.county } : {}),
    ...(opts.category ? { category: opts.category } : {}),
  };
  const [rows, total] = await Promise.all([
    db.communityReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    }),
    db.communityReport.count({ where }),
  ]);
  const reports = await Promise.all(
    rows.map(async (r) => {
      const caseCount = await db.responseCase.count({ where: { reportId: r.id } });
      return toReportDTO(r, caseCount);
    })
  );
  return { reports, total };
}

export async function updateReportAI(args: {
  reportId: string;
  aiInterpretation: string;
  aiModelVersion: string;
  aiConfidence: number;
  aiUncertainty?: string;
}): Promise<CommunityReportDTO | null> {
  const updated = await db.communityReport.update({
    where: { id: args.reportId },
    data: {
      aiInterpretation: args.aiInterpretation,
      aiModelVersion: args.aiModelVersion,
      aiConfidence: args.aiConfidence,
      aiUncertainty: args.aiUncertainty ?? null,
      aiProcessedAt: new Date(),
      status: "triaged",
    },
  });
  const caseCount = await db.responseCase.count({ where: { reportId: args.reportId } });
  return toReportDTO(updated, caseCount);
}

export async function updateReportPolicy(args: {
  reportId: string;
  policyVersion: string;
  policyDecision: string;
  policyWorkflowClass: string;
}): Promise<CommunityReportDTO | null> {
  const updated = await db.communityReport.update({
    where: { id: args.reportId },
    data: {
      policyVersion: args.policyVersion,
      policyDecision: args.policyDecision,
      policyWorkflowClass: args.policyWorkflowClass,
      status: "ready_for_assignment",
    },
  });
  const caseCount = await db.responseCase.count({ where: { reportId: args.reportId } });
  return toReportDTO(updated, caseCount);
}

function toReportDTO(row: {
  id: string; reportCode: string; createdAt: Date; updatedAt: Date;
  reporterName: string | null; reporterContact: string | null; reporterType: string;
  subjectType: string; subjectPersonId: string | null; subjectHouseholdId: string | null;
  description: string; category: string; county: string; ward: string | null;
  landmark: string | null; directions: string | null; channel: string; status: string;
  aiInterpretation: string | null; aiModelVersion: string | null; aiConfidence: number | null;
  aiUncertainty: string | null; aiProcessedAt: Date | null;
  policyVersion: string | null; policyDecision: string | null; policyWorkflowClass: string | null;
}, responseCaseCount: number): CommunityReportDTO {
  return {
    id: row.id,
    reportCode: row.reportCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reporterName: row.reporterName,
    reporterContact: row.reporterContact,
    reporterType: row.reporterType,
    subjectType: row.subjectType,
    subjectPersonId: row.subjectPersonId,
    subjectHouseholdId: row.subjectHouseholdId,
    description: row.description,
    category: row.category,
    county: row.county,
    ward: row.ward,
    landmark: row.landmark,
    directions: row.directions,
    channel: row.channel,
    status: row.status,
    aiInterpretation: row.aiInterpretation,
    aiModelVersion: row.aiModelVersion,
    aiConfidence: row.aiConfidence,
    aiProcessedAt: row.aiProcessedAt ? row.aiProcessedAt.toISOString() : null,
    policyVersion: row.policyVersion,
    policyDecision: row.policyDecision,
    policyWorkflowClass: row.policyWorkflowClass,
    responseCaseCount,
  };
}

// ---- ResponseCase CRUD ----

export async function createResponseCase(reportId: string): Promise<ResponseCaseDTO> {
  const created = await db.responseCase.create({
    data: {
      caseCode: generateCode("MSD-CASE"),
      reportId,
      status: "ready_for_assignment",
    },
    include: { report: true },
  });
  return toCaseDTO(created);
}

export async function assignChvToCase(args: {
  caseId: string;
  chvId: string;
  supervisorId?: string;
  reason: string;
  ruleVersion?: string;
}): Promise<ResponseCaseDTO | null> {
  const updated = await db.responseCase.update({
    where: { id: args.caseId },
    data: {
      assignedChvId: args.chvId,
      assignedSupervisorId: args.supervisorId ?? null,
      assignmentReason: args.reason,
      assignmentRuleVersion: args.ruleVersion ?? "1.0.0",
      assignedAt: new Date(),
      status: "assigned",
    },
    include: { report: true },
  });
  return toCaseDTO(updated);
}

export async function acceptCaseAssignment(caseId: string, chvId: string): Promise<ResponseCaseDTO | null> {
  // Ownership check: only the assigned CHV can accept.
  const existing = await db.responseCase.findUnique({ where: { id: caseId } });
  if (!existing || existing.assignedChvId !== chvId) return null;
  if (existing.status !== "assigned") return null;

  const updated = await db.responseCase.update({
    where: { id: caseId },
    data: { acceptedAt: new Date(), status: "accepted" },
    include: { report: true },
  });
  return toCaseDTO(updated);
}

export async function updateCaseStatus(args: {
  caseId: string;
  chvId: string;
  status: string;
  resolutionNote?: string;
  encounterId?: string;
}): Promise<ResponseCaseDTO | null> {
  // Ownership check.
  const existing = await db.responseCase.findUnique({ where: { id: args.caseId } });
  if (!existing || existing.assignedChvId !== args.chvId) return null;

  const data: { status: string; resolutionNote?: string; encounterId?: string; resolvedAt?: Date } = {
    status: args.status,
  };
  if (args.resolutionNote) data.resolutionNote = args.resolutionNote;
  if (args.encounterId) data.encounterId = args.encounterId;
  if (args.status === "resolved" || args.status === "unable_to_reach") {
    data.resolvedAt = new Date();
  }

  const updated = await db.responseCase.update({
    where: { id: args.caseId },
    data,
    include: { report: true },
  });
  return toCaseDTO(updated);
}

export async function getCasesForChv(chvId: string, status?: string): Promise<ResponseCaseDTO[]> {
  const where = {
    assignedChvId: chvId,
    ...(status ? { status } : {}),
  };
  const rows = await db.responseCase.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { report: true },
  });
  return rows.map(toCaseDTO);
}

export async function getCasesForSupervisor(supervisorId: string, status?: string): Promise<ResponseCaseDTO[]> {
  const where = {
    assignedSupervisorId: supervisorId,
    ...(status ? { status } : {}),
  };
  const rows = await db.responseCase.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { report: true },
  });
  return rows.map(toCaseDTO);
}

export async function getOpenCasesByCounty(county: string): Promise<{ total: number; assigned: number; unassigned: number; resolved: number }> {
  const cases = await db.responseCase.findMany({
    where: { report: { county } },
    select: { status: true, assignedChvId: true },
  });
  return {
    total: cases.length,
    assigned: cases.filter((c) => c.assignedChvId && c.status !== "resolved" && c.status !== "cancelled").length,
    unassigned: cases.filter((c) => !c.assignedChvId && c.status !== "resolved" && c.status !== "cancelled").length,
    resolved: cases.filter((c) => c.status === "resolved").length,
  };
}

function toCaseDTO(row: {
  id: string; caseCode: string; createdAt: Date; updatedAt: Date;
  reportId: string; assignedChvId: string | null; assignedSupervisorId: string | null;
  assignmentReason: string | null; assignedAt: Date | null; acceptedAt: Date | null;
  reassignedAt: Date | null; status: string; encounterId: string | null;
  resolvedAt: Date | null; resolutionNote: string | null;
  report: {
    reportCode: string; description: string; category: string; county: string;
    ward: string | null; landmark: string | null; directions: string | null;
  } | null;
}): ResponseCaseDTO {
  const r = row.report;
  return {
    id: row.id,
    caseCode: row.caseCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reportId: row.reportId,
    reportCode: r?.reportCode ?? "—",
    assignedChvId: row.assignedChvId,
    assignedSupervisorId: row.assignedSupervisorId,
    assignmentReason: row.assignmentReason,
    assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    status: row.status,
    encounterId: row.encounterId,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolutionNote: row.resolutionNote,
    reportDescription: r?.description ?? "—",
    reportCategory: r?.category ?? "—",
    county: r?.county ?? "—",
    ward: r?.ward ?? null,
    landmark: r?.landmark ?? null,
    directions: r?.directions ?? null,
  };
}
