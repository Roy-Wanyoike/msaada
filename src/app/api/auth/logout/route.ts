import { NextResponse } from "next/server";
import { clearSession, logAuthEvent } from "@/lib/auth";

// Cookie writes → never static.
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 * Revokes the current Supabase refresh token and clears its auth cookies.
 * The logout is recorded in the AuthEvent audit trail (best-effort).
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
