import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { qwenConfigured } from "@/lib/ai/client";
import { suggestFollowUpQuestions } from "@/lib/ai/followup";

export const dynamic = "force-dynamic";

/**
 * GET /api/followups/[id]/suggestions
 *
 * AI-suggested questions for the follow-up visit. Owner-only (the follow-up's
 * CHV). Sends the model only the earlier visit's structured result.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!qwenConfigured()) {
    return NextResponse.json({ error: "AI_NOT_CONFIGURED" }, { status: 503 });
  }
  const { id } = await params;

  const followUp = await db.followUp.findUnique({
    where: { id },
    select: {
      chvId: true,
      triageRecord: {
        select: {
          createdAt: true,
          classification: true,
          escalation: true,
          observedIndicators: true,
          aggregateTag: true,
          chpNextAction: true,
        },
      },
    },
  });
  if (!followUp) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (followUp.chvId !== chv.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const rl = checkRateLimit(`followup-suggest:${chv.id}`, { capacity: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter: Math.ceil(rl.retryAfterMs / 1000) },
      { status: 429 }
    );
  }

  const t = followUp.triageRecord;
  let indicators: string[] = [];
  try {
    const parsed: unknown = JSON.parse(t.observedIndicators);
    if (Array.isArray(parsed)) indicators = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    // stored as JSON; ignore malformed legacy rows
  }

  const suggestions = await suggestFollowUpQuestions({
    classification: t.classification,
    escalation: t.escalation,
    observedIndicators: indicators,
    aggregateTag: t.aggregateTag,
    chpNextAction: t.chpNextAction,
    daysSinceVisit: Math.max(0, Math.round((Date.now() - t.createdAt.getTime()) / 86_400_000)),
  });
  if (!suggestions) {
    return NextResponse.json({ error: "SUGGESTIONS_FAILED" }, { status: 502 });
  }
  return NextResponse.json(suggestions);
}
