import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/triage-store";

// Aggregate stats change with each insert → never static.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/dashboard
 *
 * Public for the demo (no auth) — returns aggregate-only stats
 * (byCounty, byDay, byTag, totals). The data-access layer guarantees
 * observed_indicators / chp_next_action / confidence_note TEXT is never
 * surfaced here — only counts.
 *
 * TODO (production): enforce county RBAC — read the session CHV and filter
 * getDashboardStats by chv.county (mirror Supabase RLS). Add an admin-scope
 * override for county/national supervisors.
 */
export async function GET() {
  const stats = await getDashboardStats();
  return NextResponse.json(stats, { status: 200 });
}
