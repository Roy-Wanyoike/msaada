import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  hashPassword,
  DEMO_CHV_EMAIL,
  DEMO_CHV_PASSWORD,
} from "@/lib/auth";

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
  let chv = await db.chvUser.findUnique({
    where: { email: DEMO_CHV_EMAIL },
  });
  if (!chv) {
    chv = await db.chvUser.create({
      data: {
        email: DEMO_CHV_EMAIL,
        passwordHash: hashPassword(DEMO_CHV_PASSWORD),
        fullName: "Demo CHV",
        county: "Kilifi",
        ward: "Malindi Town",
      },
    });
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
