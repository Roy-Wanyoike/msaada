import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, setSession } from "@/lib/auth";

// Cookie-session writes → never static.
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 * Body: { email, password }
 * 401 INVALID_CREDENTIALS on any miss (no enumeration).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }
  const { email, password } = (body ?? {}) as {
    email?: unknown;
    password?: unknown;
  };

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.trim().length === 0 ||
    password.length === 0
  ) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  const chv = await db.chvUser.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!chv || !verifyPassword(password, chv.passwordHash)) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  await setSession(chv.id);
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
