import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, setSession, rateLimitIdentifier } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

// Cookie-session writes → never static.
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 * Body: { email, password }
 *
 * Responses:
 *  - 200 { chv } on success
 *  - 401 INVALID_CREDENTIALS on any miss (no enumeration)
 *  - 403 ACCOUNT_SUSPENDED if creds are valid but authState !== "active"
 *    (covers suspended / deactivated / not-yet-onboarded states)
 *  - 429 RATE_LIMITED after 5 attempts / 60s per (ip, email) pair
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

  // Rate-limit BEFORE any DB query. Email is needed for the key, so we parse
  // the body above first. 5 attempts / 60s per (ip, email) pair — catches
  // both single-IP brute-force and distributed attacks against one account.
  // See src/lib/auth.ts → rateLimitIdentifier for the rationale.
  const ip = req.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const rlKey = rateLimitIdentifier(ip, email.trim().toLowerCase());
  const rl = checkRateLimit(rlKey, { capacity: 5, windowMs: 60_000 });
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  const chv = await db.chvUser.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!chv || !verifyPassword(password, chv.passwordHash)) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  // Auth-boundary check (C1): only "active" accounts may obtain a session.
  // This blocks suspended / deactivated / not-yet-onboarded states from
  // re-entering the system at the login boundary, so every downstream
  // endpoint can trust the session without re-checking authState per call.
  // authState values (per prisma schema):
  //   invited | verification_pending | verified | credentials_created |
  //   device_registered | active | suspended | deactivated
  if (chv.authState && chv.authState !== "active") {
    return NextResponse.json({ error: "ACCOUNT_SUSPENDED" }, { status: 403 });
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
