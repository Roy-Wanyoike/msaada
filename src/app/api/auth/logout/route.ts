import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

// Cookie writes → never static.
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 * Clears the msaada_session cookie.
 */
export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true }, { status: 200 });
}
