import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, setSession } from "@/lib/auth";
import { generateCode } from "@/lib/identity-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/invitations/[token] — validate an invitation token.
 * Returns the invitation details (email, fullName, role, organization,
 * chuId) so the invitee can see what they're being invited to.
 *
 * This is the public-facing endpoint (no auth) — the invitee receives a
 * link like /?invite=TOKEN and the client fetches this to show the
 * "Set your credentials" form.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "MISSING_TOKEN" }, { status: 400 });
  }

  const invitation = await db.invitation.findUnique({
    where: { token },
    include: { organization: { select: { name: true, county: true } } },
  });

  if (!invitation) {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 404 });
  }
  if (invitation.status === "accepted") {
    return NextResponse.json({ error: "ALREADY_ACCEPTED" }, { status: 410 });
  }
  if (invitation.status === "revoked" || new Date() > invitation.expiresAt) {
    return NextResponse.json({ error: "EXPIRED" }, { status: 410 });
  }

  return NextResponse.json({
    id: invitation.id,
    email: invitation.email,
    fullName: invitation.fullName,
    role: invitation.role,
    organization: invitation.organization
      ? { name: invitation.organization.name, county: invitation.organization.county }
      : null,
    chuId: invitation.chuId,
    expiresAt: invitation.expiresAt.toISOString(),
  });
}

/**
 * POST /api/invitations/[token] — accept an invitation + create the account.
 * Body: { password, fullName? }
 *
 * This is the onboarding "set credentials" step (§3, §10). The invitee
 * sets a password → the account is created with authState=ACTIVE → the
 * invitation is marked ACCEPTED → a session is set.
 *
 * For the demo, this skips the VERIFICATION_PENDING / DEVICE_REGISTERED
 * steps. Production would require identity verification + device binding
 * before ACTIVE.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "MISSING_TOKEN" }, { status: 400 });
  }

  const invitation = await db.invitation.findUnique({
    where: { token },
  });
  if (!invitation) {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 404 });
  }
  if (invitation.status === "accepted") {
    return NextResponse.json({ error: "ALREADY_ACCEPTED" }, { status: 410 });
  }
  if (invitation.status === "revoked" || new Date() > invitation.expiresAt) {
    return NextResponse.json({ error: "EXPIRED" }, { status: 410 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const { password, fullName } = body as { password?: string; fullName?: string };

  if (!password || password.length < 6) {
    return NextResponse.json(
      { error: "PASSWORD_TOO_SHORT", field: "password" },
      { status: 400 }
    );
  }

  // Check if user already exists (shouldn't, but defensive).
  const existing = await db.chvUser.findUnique({ where: { email: invitation.email } });
  if (existing) {
    return NextResponse.json({ error: "USER_EXISTS" }, { status: 409 });
  }

  // Create the user with the invitation's role + organization.
  const org = invitation.organizationId
    ? await db.organization.findUnique({ where: { id: invitation.organizationId } })
    : null;

  const user = await db.chvUser.create({
    data: {
      email: invitation.email,
      fullName: fullName || invitation.fullName || "New CHV",
      passwordHash: hashPassword(password),
      role: invitation.role,
      authState: "active", // skips verification + device steps for the demo
      organizationId: invitation.organizationId ?? null,
      invitedById: invitation.invitedById,
      county: org?.county ?? null,
    },
  });

  // Mark invitation as accepted.
  await db.invitation.update({
    where: { id: invitation.id },
    data: { status: "accepted", acceptedAt: new Date() },
  });

  // Set session.
  await setSession(user.id);

  return NextResponse.json(
    {
      chv: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        county: user.county,
        ward: user.ward,
        role: user.role,
      },
    },
    { status: 201 }
  );
}
