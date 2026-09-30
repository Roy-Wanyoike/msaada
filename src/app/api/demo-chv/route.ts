import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SUPABASE_PASSWORD_MARKER,
  DEMO_CHV_EMAIL,
  DEMO_CHV_PASSWORD,
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_PASSWORD,
} from "@/lib/auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { isDemoMode } from "@/lib/deployment-mode";
import { hashPassword } from "@/lib/local-session";

// Cookie/DB writes → never static.
export const dynamic = "force-dynamic";

/**
 * POST /api/demo-chv
 * Idempotent: ensures the two demo accounts exist
 * (demo@msaada.health / msaada123 and county.admin@msaada.health / msaada123)
 * and returns the CHV credentials so the UI can prefill / display them.
 *
 * Provider selection:
 *  - Supabase (primary): when the admin client is available, the documented
 *    demo credentials are synchronized into Supabase Auth (create or update
 *    by email) and the local rows keep the SUPABASE_PASSWORD_MARKER.
 *  - Local (fallback, issue #53): when no admin client is available AND the
 *    deployment is in demo mode, the two rows are ensured locally with real
 *    scrypt `passwordHash` values — set ONLY when the row is missing or
 *    still carries the marker (never overwrites a real local credential an
 *    operator may have set, and never rewrites a row's email identity).
 *    This is the flow the AuthCard retry (login → provision → login) relies
 *    on for zero-config local demos.
 *  - No admin client and NOT demo mode → 404 (route does not exist there).
 *
 * TODO (production): remove this route or gate behind a feature flag.
 */
export async function POST() {
  if (!isDemoMode()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const supabase = createAdminClient();

  // ── Local fallback (demo mode, issue #53) ──────────────────────────────
  // Ensures both demo users exist with real local hashes so the login
  // fallback can verify them. Idempotent by email; the response shape is
  // identical to the Supabase branch below.
  if (!supabase) {
    const ensureLocalDemoUser = async (input: {
      email: string;
      password: string;
      fullName: string;
      role: string;
    }) => {
      const existing = await db.chvUser.findUnique({
        where: { email: input.email },
      });
      if (!existing) {
        return db.chvUser.create({
          data: {
            email: input.email,
            passwordHash: hashPassword(input.password),
            fullName: input.fullName,
            county: "Kilifi",
            ward: "Malindi Town",
            role: input.role,
          },
        });
      }
      if (existing.passwordHash.startsWith(SUPABASE_PASSWORD_MARKER)) {
        // Marker row (created under a Supabase-managed deployment) — give it
        // a usable local credential. Email identity is untouched.
        return db.chvUser.update({
          where: { id: existing.id },
          data: { passwordHash: hashPassword(input.password) },
        });
      }
      return existing;
    };

    try {
      const chv = await ensureLocalDemoUser({
        email: DEMO_CHV_EMAIL,
        password: DEMO_CHV_PASSWORD,
        fullName: "Demo CHV",
        role: "chv",
      });
      await ensureLocalDemoUser({
        email: DEMO_ADMIN_EMAIL,
        password: DEMO_ADMIN_PASSWORD,
        fullName: "County Admin (Demo)",
        role: "county_admin",
      });

      return NextResponse.json(
        {
          email: DEMO_CHV_EMAIL,
          password: DEMO_CHV_PASSWORD,
          chv: {
            id: chv.id,
            email: chv.email,
            fullName: chv.fullName,
            county: chv.county,
            ward: chv.ward,
          },
        },
        { status: 200 }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        "[demo-auth] local demo provisioning failed:",
        msg.slice(0, 120)
      );
      return NextResponse.json({ error: "SERVER_ERROR" }, { status: 503 });
    }
  }

  let chv = await db.chvUser.findUnique({
    where: { email: DEMO_CHV_EMAIL },
  });
  if (!chv) {
    chv = await db.chvUser.create({
      data: {
        email: DEMO_CHV_EMAIL,
        passwordHash: SUPABASE_PASSWORD_MARKER,
        fullName: "Demo CHV",
        county: "Kilifi",
        ward: "Malindi Town",
      },
    });
  }

  let admin = await db.chvUser.findUnique({
    where: { email: DEMO_ADMIN_EMAIL },
  });
  if (!admin) {
    admin = await db.chvUser.create({
      data: {
        email: DEMO_ADMIN_EMAIL,
        passwordHash: SUPABASE_PASSWORD_MARKER,
        fullName: "County Admin (Demo)",
        county: "Kilifi",
        ward: "Malindi Town",
        role: "county_admin",
      },
    });
  }

  // Keep the two documented demo credentials synchronized with Supabase.
  // The secret-key client is server-only; no privileged key reaches the UI.
  const { data: users, error: listError } =
    await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    console.error("[demo-auth] unable to inspect Supabase demo users");
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 503 });
  }

  const ensureDemoIdentity = async (input: {
    email: string;
    password: string;
    fullName: string;
    county: string;
    ward: string;
    role: string;
  }) => {
    const existing = users.users.find(
      (user) => user.email?.toLowerCase() === input.email.toLowerCase()
    );
    const attributes = {
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: input.fullName,
        county: input.county,
        ward: input.ward,
        role: input.role,
      },
    };

    return existing
      ? supabase.auth.admin.updateUserById(existing.id, attributes)
      : supabase.auth.admin.createUser(attributes);
  };

  const [demoAuth, adminAuth] = await Promise.all([
    ensureDemoIdentity({
      email: DEMO_CHV_EMAIL,
      password: DEMO_CHV_PASSWORD,
      fullName: chv.fullName ?? "Demo CHV",
      county: chv.county ?? "Kilifi",
      ward: chv.ward ?? "Malindi Town",
      role: chv.role ?? "chv",
    }),
    ensureDemoIdentity({
      email: DEMO_ADMIN_EMAIL,
      password: DEMO_ADMIN_PASSWORD,
      fullName: admin.fullName ?? "County Admin (Demo)",
      county: admin.county ?? "Kilifi",
      ward: admin.ward ?? "Malindi Town",
      role: admin.role ?? "county_admin",
    }),
  ]);

  if (demoAuth.error || adminAuth.error) {
    console.error("[demo-auth] Supabase demo user provisioning failed");
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 503 });
  }

  return NextResponse.json(
    {
      email: DEMO_CHV_EMAIL,
      password: DEMO_CHV_PASSWORD,
      chv: {
        id: chv.id,
        email: chv.email,
        fullName: chv.fullName,
        county: chv.county,
        ward: chv.ward,
      },
    },
    { status: 200 }
  );
}
