import { NextResponse } from "next/server";
import { getSessionChv } from "@/lib/auth";
import { createHousehold, getMyHouseholds } from "@/lib/identity-store";

export const dynamic = "force-dynamic";

/** GET /api/households — list the CHV's assigned households (ownership-scoped). */
export async function GET() {
  const chv = await getSessionChv();
  if (!chv) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const households = await getMyHouseholds(chv.id);
  return NextResponse.json({ households });
}

/** POST /api/households — create a household assigned to the CHV. */
export async function POST(req: Request) {
  const chv = await getSessionChv();
  if (!chv) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { county, ward, label } = await req.json().catch(() => ({}));
  if (!county || !label) {
    return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
  }
  const household = await createHousehold({
    chwId: chv.id,
    county,
    ward,
    label: String(label).slice(0, 100),
  });
  return NextResponse.json(household, { status: 201 });
}
