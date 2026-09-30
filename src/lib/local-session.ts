import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

/**
 * Local (no-Supabase) session provider — the demo-mode auth fallback.
 *
 * Commit d92348d made auth Supabase-only; without Supabase env vars every
 * login returned 503 SERVER_NOT_CONFIGURED, breaking the zero-config local
 * demo promised by the README (and the verify.sh --smoke gate). This module
 * restores a self-contained credential + cookie-session provider, adapted
 * from the pre-rewrite src/lib/auth.ts (commit d40c43d):
 *
 *   - scrypt password hashing (`salt:hash` hex, timing-safe compare)
 *   - HMAC-SHA256-signed opaque session tokens (payload {uid, exp})
 *   - DB-backed AuthSession rows (revocable, only the token HASH persists)
 *
 * Supabase Auth remains the PRIMARY provider whenever it is configured —
 * this code path only activates when `createClient()` returns null AND the
 * deployment is in demo mode (see src/lib/deployment-mode.ts). Routes gate
 * the fallback through isDemoMode(); nothing here is reachable in a
 * production deployment unless the operator sets MSAADA_DEMO_MODE=true.
 *
 * Production note: replace with Supabase Auth + auth.uid() RLS policies.
 */

export const SESSION_COOKIE = "msaada_session";
export const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

// Demo-only fallback secret (development only). Production never uses this —
// see resolveSessionSecret: a production boot without MSAADA_SESSION_SECRET
// mints its own high-entropy EPHEMERAL secret instead of falling back to a
// forgeable constant.
const DEFAULT_SESSION_SECRET =
  "msaada-demo-session-secret-do-not-use-in-production-8f3a9c2b7e1d";

export type SessionSecretMode = "configured" | "ephemeral" | "demo";

function resolveSessionSecret(): {
  secret: string;
  mode: SessionSecretMode;
} {
  const envSecret = process.env.MSAADA_SESSION_SECRET;
  if (envSecret && envSecret.length >= 32) {
    return { secret: envSecret, mode: "configured" };
  }
  if (process.env.NODE_ENV === "production") {
    // Production without a usable MSAADA_SESSION_SECRET: mint a fresh,
    // high-entropy (256-bit) EPHEMERAL secret for this process instead of
    // failing every login with 503 SERVER_NOT_CONFIGURED or falling back to
    // a forgeable constant. Trade-off, deliberately accepted and surfaced on
    // /status + /api/health (sessionSecretMode): sessions are only valid for
    // THIS process — a cold start or redeploy rotates the secret, so users
    // simply sign in again. Nothing is weakened against attackers: the
    // secret is random, never persisted, never logged; password hashing,
    // rate limiting, and DB-backed revocation are unchanged. Set
    // MSAADA_SESSION_SECRET (>=32 chars) for sessions that survive restarts.
    const ephemeral = randomBytes(32).toString("base64");
    console.warn(
      "[auth] MSAADA_SESSION_SECRET is not set (or shorter than 32 chars) — " +
        "using an EPHEMERAL per-boot session secret. Login works, but sessions " +
        "reset when this instance restarts. Set MSAADA_SESSION_SECRET (>=32 " +
        "chars) for stable sessions."
    );
    return { secret: ephemeral, mode: "ephemeral" };
  }
  return { secret: DEFAULT_SESSION_SECRET, mode: "demo" };
}

// Lazy, memoized resolution. This module is imported by API routes that Next
// evaluates during `next build` page-data collection with NODE_ENV=production,
// so throwing at module scope would fail every deploy that hasn't set
// MSAADA_SESSION_SECRET yet — even though sessions are only ever used at
// request time. Resolution is deferred to the first signing operation instead.
let cachedSecret: string | null = null;
let cachedMode: SessionSecretMode | null = null;

function sessionSecret(): string {
  if (cachedSecret === null) {
    const resolved = resolveSessionSecret();
    cachedSecret = resolved.secret;
    cachedMode = resolved.mode;
  }
  return cachedSecret;
}

/**
 * How the signing secret was resolved — "configured" (env var, stable
 * across restarts), "ephemeral" (production fallback: random per boot,
 * login works but sessions reset on restart) or "demo" (development
 * fallback). Informational only: never expose the secret itself. Surfaced
 * additively by /api/health and /status so operators can tell WHY sessions
 * reset across restarts.
 */
export function sessionSecretMode(): SessionSecretMode {
  sessionSecret(); // ensure resolution
  return cachedMode!;
}

/**
 * SHA-256 of an opaque token — the ONLY form of a session token that is ever
 * persisted. The database stores hashes, so a database read (backup, SQL
 * editor session, support query) can never be replayed into a valid cookie.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** HMAC-SHA256 over the payload bytes, base64url-encoded. */
function signPayload(payload: Buffer): string {
  return createHmac("sha256", sessionSecret())
    .update(payload)
    .digest()
    .toString("base64url");
}

/**
 * scrypt password hash in `salt:hash` hex form (32-byte derived key).
 * Used ONLY for local demo accounts — Supabase-managed rows carry the
 * SUPABASE_PASSWORD_MARKER instead and are rejected at login.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Constant-time scrypt verification against a `salt:hash` hex string.
 * Malformed stored values (wrong shape, non-hex) fail closed to false.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  let test: Buffer;
  let target: Buffer;
  try {
    test = scryptSync(password, salt, 32);
    target = Buffer.from(hash, "hex");
  } catch {
    return false;
  }
  return test.length === target.length && timingSafeEqual(test, target);
}

/**
 * Mint an HMAC-signed session token for `chvId`.
 * Format: base64url(JSON {uid, exp}).base64url(HMAC-SHA256(payload)).
 * The HMAC binds the payload to the server secret, so a token forged without
 * the secret fails signature verification in parseSessionToken. Supabase
 * would issue a JWT; this is the local-demo equivalent.
 */
export function createSessionToken(chvId: string): string {
  const payload = { uid: chvId, exp: Date.now() + SESSION_TTL * 1000 };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const payloadB64 = payloadBytes.toString("base64url");
  const sig = signPayload(payloadBytes);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a session token: exact `payload.signature` shape, valid base64url,
 * byte-length-checked constant-time signature compare, then payload expiry.
 * ANY format anomaly returns null — never throw, never partially trust.
 */
export function parseSessionToken(
  token: string
): { uid: string; exp: number } | null {
  try {
    // Format: base64url(payload).base64url(hmac). Reject anything that
    // doesn't split into exactly two non-empty parts before any further
    // processing.
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const payloadB64 = parts[0];
    const sigB64 = parts[1];
    if (!payloadB64 || !sigB64) return null;

    const payloadBytes = Buffer.from(payloadB64, "base64url");
    const expectedSig = signPayload(payloadBytes);

    // Constant-time compare of the base64url signatures to avoid leaking
    // signature information via timing. Length check first because
    // timingSafeEqual throws on mismatched-length buffers (and a forged
    // token may have a different-length signature segment).
    const expectedSigBytes = Buffer.from(expectedSig, "utf8");
    const providedSigBytes = Buffer.from(sigB64, "utf8");
    if (
      expectedSigBytes.length !== providedSigBytes.length ||
      !timingSafeEqual(expectedSigBytes, providedSigBytes)
    ) {
      return null;
    }

    const decoded = JSON.parse(payloadBytes.toString("utf8")) as {
      uid?: string;
      exp?: number;
    };
    if (!decoded.uid || !decoded.exp) return null;
    if (typeof decoded.exp !== "number" || decoded.exp < Date.now()) {
      return null;
    }
    return { uid: decoded.uid, exp: decoded.exp };
  } catch {
    return null;
  }
}

/**
 * Issue a local session: persist a DB-backed AuthSession row FIRST, then set
 * the cookie. The row makes the cookie token revocable server-side (logout,
 * suspension, incident kill switch).
 *
 * Order matters: if the row write fails (DB unreachable), the error
 * propagates and the cookie is never set — a session that could never be
 * validated must never be issued. Conversely, if the cookie write fails after
 * the row exists, the row is revoked immediately (mirror-failure guard) so no
 * orphaned never-presentable session lingers in the registry.
 */
export async function setLocalSession(chvId: string): Promise<void> {
  const token = createSessionToken(chvId);
  const store = await cookies();
  let userAgent: string | null = null;
  try {
    const h = await headers();
    userAgent = h.get("user-agent")?.slice(0, 180) ?? null;
  } catch {
    // headers() unavailable in some call contexts — device hint is optional
  }
  await db.authSession.create({
    data: {
      userId: chvId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL * 1000),
      userAgent,
    },
  });
  try {
    store.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      // Secure in production: deployments serve HTTPS at the edge, so the
      // session cookie must never transit a plaintext connection there.
      // Local dev (NODE_ENV=development) keeps the flag off so plain
      // http://localhost works. The smoke gate (scripts/verify.sh) runs
      // NODE_ENV=production against http://localhost:3311 — unaffected,
      // because curl treats localhost as a secure context and still replays
      // Secure cookies (verified with curl 8.x; CI ubuntu-latest ships >=8.x).
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL,
    });
  } catch (err) {
    // Mirror-failure guard: if the cookie can't be set after the row was
    // created, revoke the row immediately so no orphaned (never-presentable)
    // session lingers in the registry.
    try {
      await db.authSession.updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // best-effort — the original error below is what matters
    }
    throw err;
  }
  // Opportunistic GC: expired sessions can never validate again, so prune
  // them whenever a new one is issued (keeps the registry bounded on
  // long-lived local databases).
  try {
    await db.authSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  } catch {
    // never let housekeeping break sign-in
  }
}

/**
 * Resolve the signed-in user from the local session cookie. Validation is
 * THREE-layer (defense in depth):
 *   1. Cryptographic: HMAC signature + payload expiry (parseSessionToken).
 *   2. Database: an unexpired, unrevoked AuthSession row must exist for the
 *      exact token hash. A stolen-then-revoked cookie, or a token whose row
 *      was lost, fails here — the signature alone is not sufficient.
 *   3. Authorization state: the ChvUser must be active (authState empty or
 *      "active") — suspending a profile kills its sessions at the boundary.
 * Any failure — including DB errors — returns null (fails CLOSED, never
 * throws): an unvalidatable session must never grant access.
 */
export async function getLocalSessionChv() {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const parsed = parseSessionToken(token);
    if (!parsed) return null;
    const session = await db.authSession.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.revokedAt) return null;
    if (session.expiresAt.getTime() < Date.now()) return null;
    if (session.userId !== parsed.uid) return null; // defense in depth
    const chv = await db.chvUser.findUnique({ where: { id: parsed.uid } });
    if (!chv) return null;
    // Auth-boundary parity with the login route: suspended / deactivated /
    // not-yet-onboarded profiles resolve to NO session.
    if (chv.authState && chv.authState !== "active") return null;
    return chv;
  } catch {
    return null; // fail closed
  }
}

/**
 * Revoke the local session row (if any) and clear the cookie. Returns the
 * userId whose session was revoked (for the auth audit trail), or null.
 * Revocation is best-effort: the cookie is cleared no matter what, so the
 * user is signed out locally even if the DB write fails.
 */
export async function clearLocalSession(): Promise<string | null> {
  let revokedUserId: string | null = null;
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token) {
      try {
        const tokenHash = hashToken(token);
        const res = await db.authSession.updateMany({
          where: { tokenHash, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (res.count > 0) {
          const row = await db.authSession.findFirst({
            where: { tokenHash },
            select: { userId: true },
          });
          revokedUserId = row?.userId ?? null;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[auth] session revoke failed:", msg.slice(0, 120));
      }
      store.delete(SESSION_COOKIE);
    }
  } catch {
    // cookies() unavailable in this context — nothing to clear
  }
  return revokedUserId;
}

/** Exposed for tests/ops tooling that need to hash-verify tokens. */
export { hashToken };
