import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/invitations — list invitations sent by the current user.
 * (County Admin / Supervisor only — role check is TODO for production RBAC.)
 */
export async function GET() {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  // Only county_admin / cho_supervisor / moh_admin can view invitations.
  if (!["county_admin", "cho_supervisor", "moh_admin", "system_admin"].includes(chv.role ?? "chv")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const invitations = await db.invitation.findMany({
    where: { invitedById: chv.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { organization: { select: { name: true } } },
  });
  return NextResponse.json({ invitations });
}

/**
 * POST /api/invitations — create an invitation (County Admin invites a CHV).
 * Body: { email, fullName, role?, chuId? }
 *
 * The invitation creates a token + expiry (7 days). The invitee receives a
 * link (for the demo, shown in the response). The invitee accepts → sets
 * credentials → becomes ACTIVE (the onboarding state machine, §3, §10).
 */
export async function POST(req: Request) {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  // Only institutional roles can invite.
  if (!["county_admin", "cho_supervisor", "moh_admin", "system_admin"].includes(chv.role ?? "chv")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const { email, fullName, role, chuId } = body as {
    email?: string;
    fullName?: string;
    role?: string;
    chuId?: string;
  };

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "INVALID_EMAIL", field: "email" }, { status: 400 });
  }

  // Check if user already exists with this email.
  const existing = await db.chvUser.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "USER_EXISTS" }, { status: 409 });
  }

  // Check for existing pending invitation.
  const existingInvite = await db.invitation.findFirst({
    where: { email, status: "pending" },
  });
  if (existingInvite) {
    return NextResponse.json(
      { error: "INVITATION_EXISTS", token: existingInvite.token },
      { status: 409 }
    );
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

  const invitation = await db.invitation.create({
    data: {
      email,
      fullName: fullName ?? null,
      role: role ?? "chv",
      organizationId: chv.organizationId ?? null,
      invitedById: chv.id,
      token,
      expiresAt,
      chuId: chuId ?? null,
    },
  });

  return NextResponse.json(
    {
      id: invitation.id,
      email: invitation.email,
      fullName: invitation.fullName,
      role: invitation.role,
      token: invitation.token,
      inviteLink: `/?invite=${invitation.token}`,
      expiresAt: invitation.expiresAt.toISOString(),
    },
    { status: 201 }
  );
}
