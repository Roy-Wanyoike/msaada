import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SUPABASE_PASSWORD_MARKER,
  rateLimitIdentifier,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { COUNTIES, WARDS, type County } from "@/lib/types";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient as createSupabaseClient } from "@/utils/supabase/server";

// Cookie-session writes → never static.
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(error: string, field?: string) {
  return NextResponse.json(field ? { error, field } : { error }, { status: 400 });
}

/**
 * POST /api/auth/signup
 * Body: { email, password, fullName, county, ward? }
 * Creates a Supabase identity plus local ChvUser profile. If email confirmation
 * is enabled, returns 202; otherwise the Supabase SSR client issues cookies.
 *
 * 429 RATE_LIMITED after 5 attempts / 60s per IP — the email may not exist
 * yet (the account is being created), so the rate-limit key is IP-only.
 */
export async function POST(req: Request) {
  // Rate-limit BEFORE any DB query. Email may not exist yet (the account is
  // being created), so key on IP alone. See src/lib/auth.ts →
  // rateLimitIdentifier for the rationale.
  const ip = req.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const rlKey = rateLimitIdentifier(ip, null);
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("INVALID_JSON");
  }
  const { email, password, fullName, county, ward } = (body ?? {}) as {
    email?: unknown;
    password?: unknown;
    fullName?: unknown;
    county?: unknown;
    ward?: unknown;
  };

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return bad("INVALID_EMAIL", "email");
  }
  if (typeof password !== "string" || password.length < 6) {
    return bad("PASSWORD_TOO_SHORT", "password");
  }
  if (typeof fullName !== "string" || fullName.trim().length === 0) {
    return bad("MISSING_FULL_NAME", "fullName");
  }
  if (typeof county !== "string" || !COUNTIES.includes(county as County)) {
    return bad("INVALID_COUNTY", "county");
  }
  const countyTyped = county as County;
  let wardNormalized: string | null = null;
  if (typeof ward === "string" && ward.trim().length > 0) {
    if (!WARDS[countyTyped].includes(ward)) {
      return bad("WARD_NOT_IN_COUNTY", "ward");
    }
    wardNormalized = ward;
  }

  const emailLower = email.trim().toLowerCase();

  const existing = await db.chvUser.findUnique({
    where: { email: emailLower },
  });
  if (existing) {
    return NextResponse.json({ error: "EMAIL_EXISTS" }, { status: 409 });
  }

  const supabase = await createSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "SERVER_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: emailLower,
    password,
    options: {
      data: {
        full_name: fullName.trim(),
        county: countyTyped,
        ward: wardNormalized,
      },
    },
  });

  if (authError) {
    const duplicate =
      authError.code === "user_already_exists" ||
      /already registered/i.test(authError.message);
    const rateLimited = authError.status === 429;
    const weakPassword = authError.code === "weak_password";
    return NextResponse.json(
      {
        error: duplicate
          ? "EMAIL_EXISTS"
          : rateLimited
            ? "RATE_LIMITED"
            : weakPassword
              ? "WEAK_PASSWORD"
              : "SIGNUP_FAILED",
      },
      { status: duplicate ? 409 : rateLimited ? 429 : 400 }
    );
  }

  // With confirmation enabled, Supabase may return an obfuscated user for an
  // existing account. An empty identities list means no account was created.
  if (!authData.user || authData.user.identities?.length === 0) {
    return NextResponse.json({ error: "EMAIL_EXISTS" }, { status: 409 });
  }

  let created: Awaited<ReturnType<typeof db.chvUser.create>>;
  try {
    created = await db.chvUser.create({
      data: {
        email: emailLower,
        passwordHash: SUPABASE_PASSWORD_MARKER,
        fullName: fullName.trim(),
        county: countyTyped,
        ward: wardNormalized,
      },
    });
  } catch {
    // Best-effort compensation prevents an unusable Supabase-only identity
    // when the local operational profile cannot be created.
    const admin = createAdminClient();
    if (admin) {
      await admin.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
    }
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    console.error("[signup] local profile creation failed");
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 503 });
  }

  if (!authData.session) {
    return NextResponse.json(
      { confirmationRequired: true, email: emailLower },
      { status: 202 }
    );
  }

  return NextResponse.json(
    {
      chv: {
        id: created.id,
        email: created.email,
        fullName: created.fullName,
        county: created.county,
        ward: created.ward,
      },
    },
    { status: 200 }
  );
}
