import { NextResponse } from "next/server";
import { clearSession, logAuthEvent } from "@/lib/auth";

// Cookie writes → never static.
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 * Revokes the current session and clears its auth cookies. Provider is
 * selected inside clearSession(): with Supabase configured it revokes the
 * Supabase refresh token; without Supabase it revokes the local DB-backed
 * AuthSession row (issue #53 fallback). The logout is recorded in the
 * AuthEvent audit trail (best-effort) whenever a userId was resolved.
 */
export async function POST() {
  const signedOutUserId = await clearSession();
  if (signedOutUserId) {
    await logAuthEvent({
      event: "logout",
      userId: signedOutUserId,
      detail: "user_initiated",
    });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
