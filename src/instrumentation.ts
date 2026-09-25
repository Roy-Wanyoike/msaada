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
      console.log(
        `[db-bootstrap] ready — url=${result.databaseUrl ?? "?"}, ddl=${result.appliedStatements ?? 0}, demoChv=${result.createdDemoChv ? "created" : "present"}, demoAdmin=${result.createdDemoAdmin ? "created" : "present"}, seedReports=${result.createdSeedReports ?? 0}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[db-bootstrap] unexpected failure:", msg.slice(0, 200));
  }
}
