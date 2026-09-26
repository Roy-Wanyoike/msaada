import { NextResponse } from "next/server";
import { clearSession, logAuthEvent } from "@/lib/auth";

// Cookie writes → never static.
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 * Revokes the DB-backed session row (server-side kill switch — a replayed
 * cookie is rejected from now on) and clears the msaada_session cookie.
 * The logout is recorded in the AuthEvent audit trail (best-effort).
 */
export async function POST() {
  const revokedUserId = await clearSession();
  if (revokedUserId) {
    await logAuthEvent({
      event: "logout",
      userId: revokedUserId,
      detail: "user_initiated",
    });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
