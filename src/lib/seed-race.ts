/**
 * Cold-start race helpers for idempotent seeding (issue #58).
 *
 * `db-bootstrap.ts` runs DDL + demo seeding on EVERY serverless cold start.
 * Two instances booting concurrently both pass their "missing?" checks and
 * race on the same INSERTs. With unique constraints in place (Organization
 * name+type, CommunityHealthUnit name+county, FollowUp triageRecordId, and
 * the stable seed codes), the loser receives a unique-violation instead of
 * silently forking demo data — these helpers turn that violation into a
 * re-read of the winner's row so both instances converge on one dataset.
 *
 * Unconstrained append-only rows (AuditLog/AiActivity seed entries) may
 * duplicate under a simultaneous cold start; they are cosmetic meter/audit
 * blips on an ephemeral demo database, not integrity failures (documented
 * acceptance in issue #58).
 */

/** True when the error is a unique-constraint violation (Prisma P2002 or
 *  the underlying SQLite message surfaced through raw/edge errors). */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return true;
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}

/**
 * Standard idempotent create: check-then-create with a race-safe fallback.
 * `find` must locate the row by its unique key; `create` must insert it.
 * If the create loses a race (P2002), the row is re-read — when the re-read
 * also misses (pathological timing), the original error propagates rather
 * than hiding a real failure.
 */
export async function createOrFind<T>(opts: {
  find: () => Promise<T | null>;
  create: () => Promise<T>;
}): Promise<{ row: T; created: boolean }> {
  const existing = await opts.find();
  if (existing) return { row: existing, created: false };
  try {
    return { row: await opts.create(), created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await opts.find();
      if (raced) return { row: raced, created: false };
    }
    throw err;
  }
}
