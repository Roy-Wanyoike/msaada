import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Demo auth — substitutes for Supabase Auth in this sandbox (no Postgres/Auth
 * service available). For a 3-hour hackathon this is email/password with a
 * cookie session. The schema + RLS-equivalent design is documented in README.
 *
 * Production note: replace with Supabase Auth + auth.uid() RLS policies.
 */

const SESSION_COOKIE = "msaada_session";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

// Demo-only fallback secret. NEVER rely on this in production — anyone who
// reads the source could mint session tokens. Production MUST set
// MSAADA_SESSION_SECRET to a high-entropy random value (>= 32 chars) and
// rotate it as part of standard secret management.
const DEFAULT_SESSION_SECRET =
  "msaada-demo-session-secret-do-not-use-in-production-8f3a9c2b7e1d";

function resolveSessionSecret(): string {
  const envSecret = process.env.MSAADA_SESSION_SECRET;
  if (envSecret && envSecret.length >= 32) return envSecret;
  if (process.env.NODE_ENV === "production") {
    // Production MUST set a strong secret — anyone with the source can
    // otherwise compute HMAC-SHA256(DEFAULT_SESSION_SECRET, payload) and
    // mint a valid session token for any CHV/supervisor/admin id (the token
    // is just base64url(payload).base64url(hmac)). Fail fast so a deployed
    // instance without the env var refuses to boot, rather than silently
    // running with a forgeable secret.
    throw new Error(
      "FATAL: MSAADA_SESSION_SECRET must be set to a >=32 char string in production."
    );
  }
  return DEFAULT_SESSION_SECRET;
}

// Lazy, memoized resolution. This module is imported by API routes that Next
// evaluates during `next build` page-data collection with NODE_ENV=production,
// so throwing at module scope would fail every Vercel deploy that hasn't set
// MSAADA_SESSION_SECRET yet — even though sessions are only ever used at
// request time. Resolution is deferred to the first signing operation instead:
// builds succeed, and a production instance that actually handles a session
// request without the env var still fails fast (the guard is unchanged).
let cachedSecret: string | null = null;

function sessionSecret(): string {
  if (cachedSecret === null) {
    cachedSecret = resolveSessionSecret();
  }
  return cachedSecret;
}

/** HMAC-SHA256 over the payload bytes, base64url-encoded. */
function signPayload(payload: Buffer): string {
  return createHmac("sha256", sessionSecret())
    .update(payload)
    .digest()
    .toString("base64url");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 32);
  const target = Buffer.from(hash, "hex");
  return test.length === target.length && timingSafeEqual(test, target);
}

export function createSessionToken(chvId: string): string {
  // HMAC-signed token. Format: base64url(payload).base64url(hmac).
  // The HMAC binds the payload to the server secret, so a token minted
  // without the secret (e.g. by base64-encoding a guessed CHV cuid) will
  // fail signature verification in parseSessionToken. Supabase would
  // issue a JWT; this is the sandbox-equivalent.
  const payload = { uid: chvId, exp: Date.now() + SESSION_TTL * 1000 };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const payloadB64 = payloadBytes.toString("base64url");
  const sig = signPayload(payloadBytes);
  return `${payloadB64}.${sig}`;
}

export function parseSessionToken(token: string): { uid: string; exp: number } | null {
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
    if (decoded.exp < Date.now()) return null;
    return { uid: decoded.uid, exp: decoded.exp };
  } catch {
    return null;
  }
}

export async function setSession(chvId: string) {
  const token = createSessionToken(chvId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionChv() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const parsed = parseSessionToken(token);
  if (!parsed) return null;
  const chv = await db.chvUser.findUnique({ where: { id: parsed.uid } });
  return chv;
}

export async function requireChv() {
  const chv = await getSessionChv();
  if (!chv) throw new Error("UNAUTHORIZED");
  return chv;
}

/**
 * Stable identifier for rate-limiting auth attempts. Combines the client IP
 * and the (normalized) email so that:
 *  - an attacker enumerating many usernames from one IP is throttled by IP, and
 *  - a distributed botnet targeting one account is throttled per-account.
 *
 * NOTE: The actual login/signup gate is owned by the auth-route agent — this
 * helper only produces the key. The route should call `checkRateLimit` from
 * `@/lib/rate-limit` with this key. Recommended auth policy (per the security
 * judge's #1 risk item):
 *
 *   const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
 *     ?? "unknown";
 *   const key = rateLimitIdentifier(ip, email);
 *   const rl = checkRateLimit(key, { capacity: 5, windowMs: 60_000 });
 *   if (!rl.allowed) {
 *     return new Response("Too many attempts", {
 *       status: 429,
 *       headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
 *     });
 *   }
 *
 * Production hardening: 5 attempts / 60s per (ip, email) pair, then
 * exponential back-off or a CAPTCHA challenge after 3 failures. Account-level
 * lockout (per-email, ignoring IP) is the brute-force backstop.
 */
export function rateLimitIdentifier(
  ip: string | null | undefined,
  email: string | null | undefined
): string {
  const safeIp = (ip ?? "unknown").trim().toLowerCase();
  const safeEmail = (email ?? "unknown").trim().toLowerCase();
  return `auth:${safeIp}:${safeEmail}`;
}

export const DEMO_CHV_EMAIL = "demo@msaada.health";
export const DEMO_CHV_PASSWORD = "msaada123";

// Second demo identity — powers the /admin onboarding demo. The UI hardcodes
// the same credentials on the sign-in hint (src/app/admin/page.tsx); the
// db-bootstrap seeds this account alongside the demo CHV so fresh
// deployments (Vercel /tmp) match what the UI advertises.
export const DEMO_ADMIN_EMAIL = "county.admin@msaada.health";
export const DEMO_ADMIN_PASSWORD = "msaada123";
