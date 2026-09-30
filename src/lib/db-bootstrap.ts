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
    SUPABASE_PASSWORD_MARKER,
    DEMO_CHV_EMAIL,
    DEMO_CHV_PASSWORD,
    DEMO_ADMIN_EMAIL,
    DEMO_ADMIN_PASSWORD,
  } = await import("@/lib/auth");
  const { createAdminClient } = await import("@/utils/supabase/admin");
  const { hashPassword } = await import("@/lib/local-session");
  const { seedCommunityReports } = await import("@/lib/community-report-seed");
  const { seedDemoData } = await import("@/lib/demo-data-seed");

  // Fast path: is the schema present AND current? Probe the schema artifacts
  // that only exist in the LATEST schema version. Probing an older table
  // would pass on databases created before the latest schema change — both
  // here and on long-lived Vercel /tmp files — and wrongly skip the DDL that
  // creates the new table and the ALTER TABLE column upgrades. The DDL is
  // idempotent in practice (CREATE ... IF NOT EXISTS; ALTER failures on
  // duplicate columns are tolerated), so re-applying it to a partial schema
  // is always safe.
  // Probes (keep newest-first as columns ship):
  //  - AiActivity table (shipped with the impact meter, MVP-31), and
  //  - AuditLog.organizationId + authorizationRole columns (MVP-44 audit
  //    org/authz upgrade). findFirst always projects the selected columns,
  //    so a pre-MVP-44 AuditLog fails this query even when empty — which is
  //    exactly what forces the ALTER TABLE upgrade path on old databases.
  //  - TriageRecord.missingInformation + ResponseCase.aiSummary columns
  //    (issue #55): a pre-#55 database fails these probes, forcing the DDL
  //    (and its ALTER TABLE upgrades) to run and add the new columns.
  let schemaReady = false;
  try {
    await Promise.all([
      db.aiActivity.findFirst({ select: { id: true } }),
      db.auditLog.findFirst({
        select: { id: true, organizationId: true, authorizationRole: true },
      }),
      db.triageRecord.findFirst({
        select: { id: true, missingInformation: true },
      }),
      db.responseCase.findFirst({
        select: { id: true, aiSummary: true, aiSummaryAt: true },
      }),
    ]);
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

  // Credential ownership for the demo accounts (issue #53): when a Supabase
  // admin client is available, Supabase Auth owns their credentials and the
  // local rows carry the SUPABASE_PASSWORD_MARKER (POST /api/demo-chv keeps
  // Supabase in sync). Without one, the rows get REAL local scrypt hashes so
  // the demo-mode login fallback can verify them — the zero-config local
  // demo must work on a fresh DB with no Supabase env vars. Idempotent:
  // existing rows are only upgraded from the marker to a local hash (never
  // the other way, and never a row's email identity); a real local hash is
  // left untouched. createAdminClient() is null exactly when Supabase auth
  // provisioning is unavailable, which is the same condition under which the
  // login route routes credentials to the local verifier.
  const supabaseAdmin = createAdminClient();

  // Ensure-or-upgrade one demo identity. Returns [user, created].
  const ensureDemoUser = async (input: {
    email: string;
    password: string;
    fullName: string;
    role?: string;
  }): Promise<[Awaited<ReturnType<typeof db.chvUser.findUnique>>, boolean]> => {
    // Supabase-managed deployments keep the marker (Supabase Auth owns the
    // credential); local deployments hash the demo password with scrypt so
    // the login fallback can verify it.
    const passwordHash = supabaseAdmin
      ? SUPABASE_PASSWORD_MARKER
      : hashPassword(input.password);
    const existing = await db.chvUser.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      if (
        !supabaseAdmin &&
        existing.passwordHash.startsWith(SUPABASE_PASSWORD_MARKER)
      ) {
        // Supabase-managed marker row from an earlier Supabase-configured
        // boot: Supabase is gone, so give the row a usable local credential
        // (email identity untouched).
        const upgraded = await db.chvUser.update({
          where: { id: existing.id },
          data: { passwordHash },
        });
        return [upgraded, false];
      }
      return [existing, false];
    }
    const created = await db.chvUser.create({
      data: {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        county: "Kilifi",
        ward: "Malindi Town",
        ...(input.role ? { role: input.role } : {}),
      },
    });
    return [created, true];
  };

  // Demo CHV — identical semantics to POST /api/demo-chv.
  const [chv, createdDemoChv] = await ensureDemoUser({
    email: DEMO_CHV_EMAIL,
    password: DEMO_CHV_PASSWORD,
    fullName: "Demo CHV",
  });

  // Demo county admin — the /admin page advertises these credentials on its
  // sign-in hint, so fresh deployments must have the account (county_admin
  // is one of the institutional roles the admin page gates on).
  const [admin, createdDemoAdmin] = await ensureDemoUser({
    email: DEMO_ADMIN_EMAIL,
    password: DEMO_ADMIN_PASSWORD,
    fullName: "County Admin (Demo)",
    role: "county_admin",
  });
  if (!chv || !admin) {
    // TS exhaustiveness: ensureDemoUser always returns a user or throws.
    throw new Error("demo user provisioning returned no row");
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
