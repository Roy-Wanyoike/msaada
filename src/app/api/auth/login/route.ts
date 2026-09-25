import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  verifyPassword,
  setSession,
  rateLimitIdentifier,
  logAuthEvent,
} from "@/lib/auth";
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
 *  - 503 SERVER_NOT_CONFIGURED when the deployment is missing
 *    MSAADA_SESSION_SECRET (production fail-fast guard)
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

  const emailNormalized = email.trim().toLowerCase();
  let chv: Awaited<ReturnType<typeof db.chvUser.findUnique>>;
  try {
    chv = await db.chvUser.findUnique({
      where: { email: emailNormalized },
    });
  } catch {
    // DB outage: fail closed with the same shaped-error taxonomy as the
    // missing-secret case (no stack, no internals in the response body).
    console.error("[login] credential lookup failed (database unreachable)");
    return NextResponse.json(
      { error: "SERVER_ERROR", message: "Authentication is temporarily unavailable." },
      { status: 503 }
    );
  }
  if (!chv || !verifyPassword(password, chv.passwordHash)) {
    // Audit trail: record the failed attempt (outcome detail is server-side
    // only — the response below stays identical for unknown accounts and
    // wrong passwords, so no enumeration leak is introduced).
    await logAuthEvent({
      event: "login_failed",
      userId: chv?.id ?? null,
      emailAttempt: emailNormalized,
      detail: chv ? "invalid_password" : "unknown_account",
    });
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
    await logAuthEvent({
      event: "login_failed",
      userId: chv.id,
      emailAttempt: emailNormalized,
      detail: `auth_state:${chv.authState}`,
    });
    return NextResponse.json({ error: "ACCOUNT_SUSPENDED" }, { status: 403 });
  }

  // setSession() resolves the session secret, which fails fast in production
  // when MSAADA_SESSION_SECRET is missing/too short (deliberate P0 guard).
  // Surface that as an explicit 503 instead of an opaque 500-with-empty-body,
  // so an operator testing a fresh deployment immediately knows it is a
  // configuration problem, not a code or credential problem. The message
  // names the env var only — its VALUE is never echoed.
  try {
    await setSession(chv.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("MSAADA_SESSION_SECRET")) {
      console.error("[login] server misconfigured:", msg.slice(0, 160));
      return NextResponse.json(
        {
          error: "SERVER_NOT_CONFIGURED",
          message:
            "MSAADA_SESSION_SECRET must be set to a >=32 char string in the deployment environment.",
        },
        { status: 503 }
      );
    }
    throw err;
  }
  await logAuthEvent({
    event: "login_succeeded",
    userId: chv.id,
    emailAttempt: emailNormalized,
    detail: null,
  });
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
