import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";

// Cookie reads → never static.
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 * Returns the current session's CHV (or null). Used by the UI to hydrate
 * login state on first load.
 */
export async function GET() {
  const chv = await getSessionChv();
  if (!chv) {
    return NextResponse.json({ chv: null }, { status: 200 });
  }
  return NextResponse.json(
    {
      chv: {
        id: chv.id,
        email: chv.email,
        fullName: chv.fullName,
        county: chv.county,
        ward: chv.ward,
        role: chv.role,
      },
    },
    { status: 200 }
  );
}
