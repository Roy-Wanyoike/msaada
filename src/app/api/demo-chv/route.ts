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

// Cookie/DB writes → never static.
export const dynamic = "force-dynamic";

/**
 * POST /api/demo-chv
 * Idempotent: creates the demo CHV (demo@msaada.health / msaada123) if missing,
 * returns the credentials so the UI can prefill / display them.
 *
 * TODO (production): remove this route or gate behind a feature flag.
 */
export async function POST() {
  if (!isDemoMode()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "SERVER_NOT_CONFIGURED" },
      { status: 503 }
    );
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
