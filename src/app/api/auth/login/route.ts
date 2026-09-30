import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SUPABASE_PASSWORD_MARKER,
  rateLimitIdentifier,
  logAuthEvent,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/utils/supabase/server";
import { isDemoMode } from "@/lib/deployment-mode";
import {
  setLocalSession,
  verifyPassword,
} from "@/lib/local-session";

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
 *  - 503 SERVER_NOT_CONFIGURED when Supabase is unconfigured AND the
 *    deployment is NOT in demo mode
 *
 * Provider selection:
 *  - Supabase Auth (primary): owns credential verification and the cookie
 *    session whenever it is configured. The local ChvUser row remains the
 *    authorization/operational profile.
 *  - Local fallback (demo mode only, issue #53): when no Supabase client is
 *    available AND isDemoMode(), credentials are verified against the local
 *    scrypt `passwordHash` and a DB-backed local session cookie is issued
 *    (src/lib/local-session.ts). The response shape is identical to the
 *    Supabase path. A Supabase-managed row (SUPABASE_PASSWORD_MARKER) is
 *    rejected — its credentials are owned by Supabase and can never verify
 *    locally. Any hash mismatch returns the same generic 401 as an unknown
 *    account (no enumeration).
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
  const supabase = await createSupabaseClient();

  // ── Local fallback (demo mode, issue #53) ──────────────────────────────
  // No Supabase client: without this branch every login was 503
  // SERVER_NOT_CONFIGURED, breaking the zero-config local demo. In demo
  // mode the local scrypt hash + DB-backed cookie session take over; the
  // 503 now only fires for a NON-demo deployment that simply lacks Supabase.
  if (!supabase) {
    if (!isDemoMode()) {
      return NextResponse.json(
        {
          error: "SERVER_NOT_CONFIGURED",
          message: "Supabase Auth is not configured.",
        },
        { status: 503 }
      );
    }

    if (!chv) {
      await logAuthEvent({
        event: "login_failed",
        userId: null,
        emailAttempt: emailNormalized,
        detail: "unknown_account",
      });
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // A Supabase-managed row carries no local credential — its password is
    // owned by Supabase Auth and must never be trusted (or guessed) locally.
    // POST /api/demo-chv provisions real local hashes for the demo accounts.
    if (chv.passwordHash.startsWith(SUPABASE_PASSWORD_MARKER)) {
      await logAuthEvent({
        event: "login_failed",
        userId: chv.id,
        emailAttempt: emailNormalized,
        detail: "supabase_managed_no_local_hash",
      });
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    if (!verifyPassword(password, chv.passwordHash)) {
      await logAuthEvent({
        event: "login_failed",
        userId: chv.id,
        emailAttempt: emailNormalized,
        detail: "invalid_password",
      });
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // Auth-boundary check (C1) — identical policy to the Supabase path:
    // only "active" accounts may obtain a session.
    if (chv.authState && chv.authState !== "active") {
      await logAuthEvent({
        event: "login_failed",
        userId: chv.id,
        emailAttempt: emailNormalized,
        detail: `auth_state:${chv.authState}`,
      });
      return NextResponse.json({ error: "ACCOUNT_SUSPENDED" }, { status: 403 });
    }

    await logAuthEvent({
      event: "login_succeeded",
      userId: chv.id,
      emailAttempt: emailNormalized,
      detail: null,
    });
    await setLocalSession(chv.id);
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

  const { data: authData, error: authError } =
    await supabase.auth.signInWithPassword({
      email: emailNormalized,
      password,
    });

  if (authError || !authData.user || !chv) {
    await logAuthEvent({
      event: "login_failed",
      userId: chv?.id ?? null,
      emailAttempt: emailNormalized,
      detail: authError?.code ?? (chv ? "invalid_credentials" : "unknown_account"),
    });

    if (authError?.code === "email_not_confirmed") {
      return NextResponse.json({ error: "EMAIL_NOT_CONFIRMED" }, { status: 403 });
    }
    if (authError?.status === 429) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    if (
      authError &&
      ((authError.status ?? 0) >= 500 ||
        authError.name === "AuthRetryableFetchError")
    ) {
      return NextResponse.json({ error: "SERVER_ERROR" }, { status: 503 });
    }

    // If Supabase authenticated an orphaned identity with no local profile,
    // clear the just-issued cookies and keep the public response generic.
    if (authData.user && !chv) {
      await supabase.auth.signOut({ scope: "local" });
    }
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
    await supabase.auth.signOut({ scope: "local" });
    await logAuthEvent({
      event: "login_failed",
      userId: chv.id,
      emailAttempt: emailNormalized,
      detail: `auth_state:${chv.authState}`,
    });
    return NextResponse.json({ error: "ACCOUNT_SUSPENDED" }, { status: 403 });
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
