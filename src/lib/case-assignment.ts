import { db } from "@/lib/db";
import type { AssignmentCandidate } from "@/lib/ai/case-ops";
import { CLOSED_CASE_STATUSES } from "@/lib/community-report-types";

/**
 * Data access for supervisor case assignment: which cases still need a CHV,
 * and which CHVs are eligible (active CHVs in the case's county) with their
 * current workload.
 */

export async function getUnassignedCases(county: string | null) {
  return db.responseCase.findMany({
    where: {
      assignedChvId: null,
      status: { notIn: CLOSED_CASE_STATUSES },
      ...(county ? { report: { county } } : {}),
    },
    include: { report: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
}

export async function getAssignmentCandidates(
  county: string,
): Promise<(AssignmentCandidate & { fullName: string })[]> {
  const chvs = await db.chvUser.findMany({
    where: { role: "chv", authState: "active", county },
    select: { id: true, fullName: true, ward: true },
  });
  if (chvs.length === 0) return [];
  const ids = chvs.map((c) => c.id);
  const since = new Date(Date.now() - 7 * 86_400_000);

  const [open, recent] = await Promise.all([
    db.responseCase.groupBy({
      by: ["assignedChvId"],
      where: {
        assignedChvId: { in: ids },
        status: { notIn: CLOSED_CASE_STATUSES },
      },
      _count: true,
    }),
    db.triageRecord.groupBy({
      by: ["submittedById"],
      where: { submittedById: { in: ids }, createdAt: { gte: since } },
      _count: true,
    }),
  ]);
  const openBy = new Map(open.map((o) => [o.assignedChvId, o._count]));
  const recentBy = new Map(recent.map((r) => [r.submittedById, r._count]));

  return chvs.map((c) => {
    // Shown to Qwen instead of the name: staff identity isn't needed to choose.
    const label = `CHV ${c.id.slice(-4)}`;
    return {
      id: c.id,
      fullName: c.fullName || label,
      label,
      ward: c.ward,
      openCases: openBy.get(c.id) ?? 0,
      submissionsLast7d: recentBy.get(c.id) ?? 0,
    };
  });
}
