// Next.js 16 instrumentation hook — runs ONCE per server instance at
// startup (including every Vercel serverless cold start), BEFORE any
// request is served. It makes the database self-provisioning on
// deployments where no database file exists (Vercel serverless): see
// src/lib/db-bootstrap.ts.
//
// Failures are swallowed here on purpose — a broken bootstrap must not
// block server startup; /api/health surfaces the real database state.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureDatabaseReady } = await import("./lib/db-bootstrap");
    const result = await ensureDatabaseReady();
    if (result.status === "ok") {
      const d = result.demoData;
      // Log only the DB file's basename — never the full DATABASE_URL (the
      // bootstrap contract promises URLs are never logged verbatim).
      const dbFile =
        (result.databaseUrl ?? "?").split("/").pop() || "?";
      console.log(
        `[db-bootstrap] ready — db=${dbFile}, ddl=${result.appliedStatements ?? 0}, demoChv=${result.createdDemoChv ? "created" : "present"}, demoAdmin=${result.createdDemoAdmin ? "created" : "present"}, seedReports=${result.createdSeedReports ?? 0}, demoData=hh:${d?.households ?? 0}/m:${d?.members ?? 0}/enc:${d?.encounters ?? 0}/tri:${d?.triageRecords ?? 0}/ref:${d?.referrals ?? 0}/fu:${d?.followUps ?? 0}/audit:${d?.auditLogs ?? 0}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[db-bootstrap] unexpected failure:", msg.slice(0, 200));
  }
}
