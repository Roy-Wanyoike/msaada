// Runtime database bootstrap — makes every deployment self-provisioning.
//
// Why: Prisma uses SQLite (file:), and db/custom.db is deliberately NOT
// tracked in git (issue #14). On Vercel serverless there is no database
// file at all, and the function bundle directory is read-only — so before
// this module existed, every Prisma query on the deployed site failed
// (/api/health -> database: "error") and no one could log in.
//
// How: `ensureDatabaseReady()` runs once per server instance from
// src/instrumentation.ts `register()` (Next 16 startup hook — fires on
// every serverless cold start BEFORE any request is served). It:
//   1. Pins a writable SQLite path on Vercel (/tmp is the only writable
//      filesystem there) — applies when DATABASE_URL is unset or points
//      outside /tmp. Locally it leaves .env's path untouched.
//   2. Applies the idempotent schema DDL (src/lib/db-ddl.ts, generated
//      from prisma/schema.prisma) — only when the schema is missing or
//      OLDER than the current one (probed via a table that only exists in
//      the latest schema version).
//   3. Seeds the demo accounts, community reports, and the full demo
//      identity chain (households/encounters/triage/referrals/follow-ups —
//      see src/lib/demo-data-seed.ts). All idempotent.
//
// Trade-off (documented in README): /tmp storage is per-instance and
// ephemeral — writes survive for the lifetime of a warm lambda, then
// reset. That is the accepted demo-mode semantics; durable data belongs
// in the Supabase layer (encounter drafts + community report mirror),
// which activates once the NEXT_PUBLIC_SUPABASE_* env vars are set.
import fs from "node:fs";
import path from "node:path";
import { SQLITE_DDL } from "./db-ddl";

export type BootstrapResult = {
  status: "ok" | "skipped" | "error";
  databaseUrl?: string;
  appliedStatements?: number;
  createdDemoChv?: boolean;
  createdDemoAdmin?: boolean;
  createdSeedReports?: number;
  demoData?: {
    households: number;
    members: number;
    encounters: number;
    triageRecords: number;
    referrals: number;
    followUps: number;
    auditLogs: number;
    invitations: number;
    aiActivities: number;
  };
  error?: string;
};

let bootstrapPromise: Promise<BootstrapResult> | null = null;

/**
 * Pick the SQLite URL to bootstrap against.
 * - Vercel without a usable file: URL  -> file:/tmp/msaada-demo.db
 * - Vercel with a hosted (non-file) URL -> null (managed externally, skip)
 * - Local                              -> whatever .env says (skip if unset)
 */
function resolveSqliteUrl(): string | null {
  const onVercel = process.env.VERCEL === "1";
  const raw = process.env.DATABASE_URL?.trim() ?? "";
  if (!raw) return onVercel ? "file:/tmp/msaada-demo.db" : null;
  if (!raw.startsWith("file:")) return null;
  if (onVercel && !raw.startsWith("file:/tmp/")) return "file:/tmp/msaada-demo.db";
  return raw;
}

async function run(): Promise<BootstrapResult> {
  const url = resolveSqliteUrl();
  if (!url) return { status: "skipped" };

  // Must happen BEFORE the first PrismaClient construction — guaranteed,
  // because instrumentation register() completes before any route module
  // is imported.
  if (process.env.DATABASE_URL !== url) {
    process.env.DATABASE_URL = url;
  }

  if (url.startsWith("file:") && url !== "file::memory:") {
    const file = url.slice("file:".length).split("?")[0];
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch {
      // exists, or FS denies — the Prisma connect below will surface it
    }
  }

  // Late-bind the Prisma client + auth helpers so nothing touches the
  // database before the URL above is pinned.
  const { db } = await import("@/lib/db");
  const {
    hashPassword,
    DEMO_CHV_EMAIL,
    DEMO_CHV_PASSWORD,
    DEMO_ADMIN_EMAIL,
    DEMO_ADMIN_PASSWORD,
  } = await import("@/lib/auth");
  const { seedCommunityReports } = await import("@/lib/community-report-seed");
  const { seedDemoData } = await import("@/lib/demo-data-seed");

  // Fast path: is the schema present AND current? Probe a table that only
  // exists in the LATEST schema version (AiActivity shipped with the impact
  // meter — the newest schema addition). Probing an older table would pass
  // on databases created before the latest schema change — both here and on
  // long-lived Vercel /tmp files — and wrongly skip the DDL that creates the
  // new table and the ALTER TABLE column upgrades. The DDL is idempotent in
  // practice (CREATE ... IF NOT EXISTS; ALTER failures on duplicate columns
  // are tolerated), so re-applying it to a partial schema is always safe.
  let schemaReady = false;
  try {
    await db.aiActivity.findFirst({ select: { id: true } });
    schemaReady = true;
  } catch {
    schemaReady = false;
  }

  let appliedStatements = 0;
  if (!schemaReady) {
    // Schema missing or an older version: apply the full DDL. Individual
    // "already exists" / "duplicate column" failures are tolerated — the
    // former from IF NOT EXISTS belt-and-braces, the latter from the ALTER
    // TABLE column upgrades applied to databases that already have the
    // column. Any other failure is fatal (surfaced via /api/health).
    for (const stmt of SQLITE_DDL) {
      try {
        await db.$executeRawUnsafe(stmt);
        appliedStatements += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already exists|duplicate column/i.test(msg)) continue;
        throw new Error(`DDL failed: ${msg.slice(0, 160)}`);
      }
    }
  }

  // Schema is now guaranteed current — the demo-account lookups below can
  // hit any table safely.

  // Demo CHV — identical semantics to POST /api/demo-chv.
  let createdDemoChv = false;
  let chv = await db.chvUser.findUnique({ where: { email: DEMO_CHV_EMAIL } });
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
    createdDemoChv = true;
  }

  // Demo county admin — the /admin page advertises these credentials on its
  // sign-in hint, so fresh deployments must have the account (county_admin
  // is one of the institutional roles the admin page gates on).
  let createdDemoAdmin = false;
  let admin = await db.chvUser.findUnique({
    where: { email: DEMO_ADMIN_EMAIL },
  });
  if (!admin) {
    admin = await db.chvUser.create({
      data: {
        email: DEMO_ADMIN_EMAIL,
        passwordHash: hashPassword(DEMO_ADMIN_PASSWORD),
        fullName: "County Admin (Demo)",
        county: "Kilifi",
        ward: "Malindi Town",
        role: "county_admin",
      },
    });
    createdDemoAdmin = true;
  }

  // Demo community reports + response cases (idempotent by stable codes).
  const seed = await seedCommunityReports(chv.id);

  // Full demo identity chain: org/CHU + households + members + backdated
  // encounters + structured triage verdicts + referrals + follow-ups +
  // audit entries (idempotent by stable codes — safe on every cold start).
  const demo = await seedDemoData(chv.id, admin.id);

  return {
    status: "ok",
    databaseUrl: url,
    appliedStatements,
    createdDemoChv,
    createdDemoAdmin,
    createdSeedReports: seed.createdCount,
    demoData: {
      households: demo.householdsCreated,
      members: demo.membersCreated,
      encounters: demo.encountersCreated,
      triageRecords: demo.triageRecordsCreated,
      referrals: demo.referralsCreated,
      followUps: demo.followUpsCreated,
      auditLogs: demo.auditLogsCreated,
      invitations: demo.invitationsCreated,
      aiActivities: demo.aiActivitiesCreated,
    },
  };
}

/**
 * Idempotent, memoized per server instance. On failure the memo is reset so
 * a later request can retry; the error is logged (message only — never the
 * DATABASE_URL) and returned, never thrown into server startup.
 */
export function ensureDatabaseReady(): Promise<BootstrapResult> {
  if (!bootstrapPromise) {
    bootstrapPromise = run().catch((err): BootstrapResult => {
      bootstrapPromise = null;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[db-bootstrap] failed:", msg.slice(0, 200));
      return { status: "error", error: msg.slice(0, 200) };
    });
  }
  return bootstrapPromise;
}
