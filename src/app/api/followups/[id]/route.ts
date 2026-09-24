import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { resolveFollowUp } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/followups/[id]
 * Resolve a follow-up (mark done/missed). Ownership-scoped — only the
 * assigned CHV can resolve their own follow-up.
 *
 * Body: { status: "done" | "missed", resolutionNote?: string }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const { status, resolutionNote } = (body ?? {}) as {
    status?: string;
    resolutionNote?: string;
  };
  if (status !== "done" && status !== "missed") {
    return NextResponse.json(
      { error: "INVALID_STATUS", field: "status" },
      { status: 400 }
    );
  }

  const updated = await resolveFollowUp({
    followUpId: id,
    chvId: chv.id,
    status,
    resolutionNote,
  });
  if (!updated) {
    return NextResponse.json(
      { error: "NOT_FOUND_OR_NOT_PENDING" },
      { status: 404 }
    );
  }
  return NextResponse.json(updated, { status: 200 });
}
