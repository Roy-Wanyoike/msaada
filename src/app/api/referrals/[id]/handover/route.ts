import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { qwenConfigured } from "@/lib/ai/client";
import { draftReferralHandover } from "@/lib/ai/case-ops";

export const dynamic = "force-dynamic";

/**
 * GET /api/referrals/[id]/handover — Qwen-drafted handover note for the
 * receiving facility, from the referral and the structured triage result of
 * the same encounter (no names, no observation text). Owner-only, like
 * GET /api/referrals. Not stored: the CHV copies or shares it.
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

  const referral = await db.referral.findUnique({ where: { id } });
  if (!referral) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (referral.createdById !== chv.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const rl = checkRateLimit(`handover:${chv.id}`, { capacity: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const triage = await db.triageRecord.findFirst({
    where: { encounterId: referral.encounterId },
    orderBy: { createdAt: "desc" },
    select: {
      classification: true,
      escalation: true,
      observedIndicators: true,
      chpNextAction: true,
      aiReasoning: true,
    },
  });
  let indicators: string[] = [];
  try {
    const parsed: unknown = triage ? JSON.parse(triage.observedIndicators) : [];
    if (Array.isArray(parsed)) indicators = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    // malformed legacy row
  }

  const handover = await draftReferralHandover({
    referralCode: referral.referralCode,
    category: referral.category,
    priority: referral.priority,
    destination: referral.destination,
    createdAt: referral.createdAt.toISOString(),
    classification: triage?.classification ?? null,
    escalation: triage?.escalation ?? false,
    observedIndicators: indicators,
    chpNextAction: triage?.chpNextAction ?? null,
    reasoning: triage?.aiReasoning ?? null,
  });
  if (!handover) {
    return NextResponse.json({ error: "HANDOVER_FAILED" }, { status: 502 });
  }
  return NextResponse.json(handover);
}
