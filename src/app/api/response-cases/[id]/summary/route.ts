import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { writeCommunityReportAudit } from "@/lib/community-report-audit";
import { db } from "@/lib/db";
import {
  buildCaseSummary,
  type CaseSummaryEncounter,
  type CaseSummaryInput,
} from "@/lib/ai/case-summary";

export const dynamic = "force-dynamic";

// Roles that can view any single case (mirrors GET/PATCH in
// ../route.ts): supervisors/admins oversee cases in their scope, while a
// plain CHV may only ever see cases assigned to them. The summary prompt is
// built ONLY from structured fields those viewers already have access to.
const SUPERVISOR_ROLES = [
  "county_admin",
  "cho_supervisor",
  "moh_admin",
  "system_admin",
];

// Cache lifetime for a stored summary: repeated case opens inside this
// window are served from ResponseCase.aiSummary without re-billing the
// model. A client may always force regeneration with { refresh: true }.
const SUMMARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function parseJsonField(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

interface SummaryCache {
  narrative: string;
  themes: string[];
  outstandingActions: string[];
}

/** Tolerant read of the cached ResponseCase.aiSummary JSON blob. */
function parseSummaryCache(raw: string | null): SummaryCache | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SummaryCache> | null;
    if (!parsed || typeof parsed.narrative !== "string" || !parsed.narrative) {
      return null;
    }
    return {
      narrative: parsed.narrative,
      themes: Array.isArray(parsed.themes)
        ? parsed.themes.filter((x): x is string => typeof x === "string")
        : [],
      outstandingActions: Array.isArray(parsed.outstandingActions)
        ? parsed.outstandingActions.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * POST /api/response-cases/[id]/summary
 *
 * Case-level supervisor summary (issue #55, task "case_summary").
 *
 * Auth + scope: mirrors the case GET/PATCH handlers — 401 without a
 * session; 404 for an unknown case; 403 unless the caller is the assigned
 * CHV or a supervisor/admin role.
 *
 * Prompt input: ONLY already-authorized structured fields (report
 * category/status/policy verdict, linked encounters' structured indicators
 * + classifications + next actions + missing-information, follow-up
 * states, outcome category). Raw observation text is not stored anywhere
 * and is never sent.
 *
 * Cache: the latest summary is stored on ResponseCase (aiSummary/aiSummaryAt)
 * so repeated case opens do not re-bill the model; `refresh: true` forces
 * regeneration.
 *
 * Fails soft: a model outage or unconfigured key returns the deterministic
 * bullet summary (fallbackUsed: true) with HTTP 200 — never a 5xx for a
 * model problem. Advisory only: the response carries `advisory: true` and
 * the request is audit-logged.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const chv = await getSessionChv();
    if (!chv) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
    }

    // Optional body: { refresh?: boolean } — force regeneration.
    let refresh = false;
    try {
      const body = (await req.json()) as { refresh?: unknown } | null;
      refresh = body?.refresh === true;
    } catch {
      // No/invalid body — treat as a plain cached request.
    }

    const row = await db.responseCase.findUnique({
      where: { id },
      include: { report: true },
    });
    if (!row) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const isSupervisor = SUPERVISOR_ROLES.includes(chv.role ?? "chv");
    const isAssignedChv = row.assignedChvId === chv.id;
    if (!isSupervisor && !isAssignedChv) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // ---- Cache hit? -----------------------------------------------------
    // Serve the stored summary unless it is stale/expired or a refresh was
    // requested. Never re-bill the model for a repeated case open.
    if (!refresh && row.aiSummary && row.aiSummaryAt) {
      const age = Date.now() - row.aiSummaryAt.getTime();
      if (age >= 0 && age < SUMMARY_CACHE_TTL_MS) {
        const cached = parseSummaryCache(row.aiSummary);
        if (cached) {
          return NextResponse.json(
            {
              caseId: row.id,
              caseCode: row.caseCode,
              advisory: true,
              cached: true,
              summary: {
                narrative: cached.narrative,
                themes: cached.themes,
                outstandingActions: cached.outstandingActions,
              },
              // Provenance of the cached copy is unknowable at read time;
              // the generation request logged it. Expose null (unknown)
              // rather than guessing.
              fallbackUsed: null,
              generatedAt: row.aiSummaryAt.toISOString(),
            },
            { status: 200 }
          );
        }
      }
    }

    // ---- Build the structured, authorized prompt input ------------------
    // Linked encounters: the case's own encounter link (CR-010) plus — when
    // the report names a subject person — that person's recent encounters,
    // so "recurring themes across visits" has something to stand on. Every
    // field below is already de-identified structured data.
    const encounterIds = new Set<string>();
    if (row.encounterId) encounterIds.add(row.encounterId);
    if (row.report.subjectPersonId) {
      const subjectEncounters = await db.encounter.findMany({
        where: { memberId: row.report.subjectPersonId },
        select: { id: true },
        orderBy: { startedAt: "desc" },
        take: 8,
      });
      for (const e of subjectEncounters) encounterIds.add(e.id);
    }

    const encounterRows = encounterIds.size
      ? await db.encounter.findMany({
          where: { id: { in: [...encounterIds] } },
          select: { id: true, startedAt: true },
          orderBy: { startedAt: "desc" },
          take: 8,
        })
      : [];

    const triageRows = encounterRows.length
      ? await db.triageRecord.findMany({
          where: { encounterId: { in: encounterRows.map((e) => e.id) } },
          select: {
            id: true,
            encounterId: true,
            createdAt: true,
            classification: true,
            escalation: true,
            observedIndicators: true,
            aggregateTag: true,
            chpNextAction: true,
            missingInformation: true,
          },
          orderBy: { createdAt: "desc" },
          take: 16,
        })
      : [];

    // One (latest) triage per encounter keeps the prompt bounded.
    const triageByEncounter = new Map<string, (typeof triageRows)[number]>();
    for (const t of triageRows) {
      if (t.encounterId && !triageByEncounter.has(t.encounterId)) {
        triageByEncounter.set(t.encounterId, t);
      }
    }

    const encounters: CaseSummaryEncounter[] = encounterRows.flatMap((e) => {
      const t = triageByEncounter.get(e.id);
      if (!t) return [];
      const item: CaseSummaryEncounter = {
        date: (t.createdAt ?? e.startedAt).toISOString(),
        classification: t.classification,
        escalation: t.escalation,
        indicators: parseJsonField(t.observedIndicators),
        aggregateTag: t.aggregateTag,
        chpNextAction: t.chpNextAction,
        missingInformation: parseJsonField(t.missingInformation),
      };
      return [item];
    });

    const followUps = triageRows.length
      ? await db.followUp.findMany({
          where: { triageRecordId: { in: triageRows.map((t) => t.id) } },
          select: {
            status: true,
            dueAt: true,
            resolvedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 8,
        })
      : [];

    const input: CaseSummaryInput = {
      caseCode: row.caseCode,
      category: row.report.category,
      caseStatus: row.status,
      county: row.report.county,
      ward: row.report.ward,
      policyWorkflowClass: row.report.policyWorkflowClass,
      assigned: Boolean(row.assignedChvId),
      accepted: Boolean(row.acceptedAt),
      attended: row.status === "attended" || Boolean(row.encounterId),
      resolved: row.status === "resolved" || Boolean(row.resolvedAt),
      outcomeCategory: row.outcomeCategory,
      encounters,
      followUps: followUps.map((f) => ({
        status: f.status,
        dueAt: f.dueAt.toISOString(),
        resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
      })),
    };

    // ---- Generate (fails soft — deterministic fallback on any outage) ---
    const { summary, fallbackUsed, model, promptVersion } =
      await buildCaseSummary(input);
    const generatedAt = new Date();

    // ---- Cache (non-fatal) ----------------------------------------------
    await db.responseCase
      .update({
        where: { id: row.id },
        data: {
          aiSummary: JSON.stringify({
            narrative: summary.narrative,
            themes: summary.themes,
            outstandingActions: summary.outstandingActions,
          }),
          aiSummaryAt: generatedAt,
        },
        select: { id: true },
      })
      .catch((e: unknown) => {
        console.error(
          "[case-summary] cache write failed:",
          e instanceof Error ? e.message : e
        );
      });

    // ---- Audit (non-fatal, same pattern as the lifecycle events) --------
    await writeCommunityReportAudit({
      actorId: chv.id,
      event: "community_case_summary_generated",
      county: row.report.county,
      ward: row.report.ward,
      classification: row.report.policyWorkflowClass,
      escalation: row.report.policyWorkflowClass === "crisis_override",
      policyVersion: row.report.policyVersion,
      organizationId: chv.organizationId ?? null,
      authorizationRole: chv.role ?? "chv",
    });

    console.log(
      `[case-summary] case=${row.caseCode} actor=${chv.id} fallback=${fallbackUsed} model=${model} advisory=true`
    );

    return NextResponse.json(
      {
        caseId: row.id,
        caseCode: row.caseCode,
        advisory: true,
        cached: false,
        summary,
        fallbackUsed,
        model,
        promptVersion,
        generatedAt: generatedAt.toISOString(),
      },
      { status: 200 }
    );
  } catch (err) {
    // Last-resort guard — model outages NEVER land here (buildCaseSummary
    // fails soft); this is for unexpected internal errors only.
    console.error("[response-cases summary] internal error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
