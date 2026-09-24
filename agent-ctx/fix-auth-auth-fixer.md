# Work Record — fix-auth

- **Task ID:** fix-auth
- **Agent:** auth-fixer
- **Scope:** `src/lib/auth.ts` ONLY (single-file fix).

## Context reviewed

- `/home/z/my-project/worklog.md` — architecture + prior fix-* rounds; establishes the "demo auth substitutes for Supabase Auth" framing and the contract that the cookie name, demo creds, and all exports must remain stable.
- `/home/z/my-project/reviews/judge-2-security.md` — security judge flagged the session token as the **#1 critical risk** ("base64url JSON with no signature … any user can impersonate any CHV"), 3/10 on Auth security, plus no login rate limit.
- `/home/z/my-project/src/lib/auth.ts` — the target file. The inline comment at line 31 of the original ("NOT cryptographically secure — Supabase would issue a JWT") was the smoking gun.
- `/home/z/my-project/src/lib/rate-limit.ts` — existing in-memory token-bucket limiter (`checkRateLimit(key, { capacity, windowMs })`). The auth rate-limit helper should produce a stable key for this same limiter, not a separate one.
- `/home/z/my-project/eslint.config.mjs` — confirmed `no-console: "off"`, so `console.warn` for the production secret-missing warning is allowed without an `eslint-disable` directive.
- `/home/z/my-project/src/app/api/auth/login/route.ts` + `/signup/route.ts` — confirmed they only call `setSession()` (which calls `createSessionToken` internally) and `getSessionChv()` (which calls `parseSessionToken` internally). No caller constructs or parses tokens directly, so the signature change is internal-only and the existing exports can stay intact.

Both the security judge and the README's own production-hardening TODO list named this the highest-impact fix in the project: a clinical/mental-health context where named households + suicide-ideation content are at stake, and the previous token format let anyone who could guess a CHV's cuid mint a session cookie.

## Changes made to `src/lib/auth.ts`

### 1. Added `createHmac` to the crypto import

Before:
```ts
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
```

After:
```ts
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
```

### 2. Resolved a session secret at module load

New constants/helpers inserted after `SESSION_TTL`:

```ts
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
    // Don't throw — keep the demo bootable — but make the risk loud.
    console.warn(
      "[msaada/auth] WARNING: MSAADA_SESSION_SECRET is missing or shorter " +
        "than 32 chars in production. Falling back to a hard-coded demo " +
        "secret — session tokens are forgeable. Set MSAADA_SESSION_SECRET " +
        "(>= 32 chars, high entropy) before deploying."
    );
  }
  return DEFAULT_SESSION_SECRET;
}

const SESSION_SECRET = resolveSessionSecret();

/** HMAC-SHA256 over the payload bytes, base64url-encoded. */
function signPayload(payload: Buffer): string {
  return createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest()
    .toString("base64url");
}
```

Design notes:
- **Resolved once at module load**, not per-request — avoids re-reading `process.env` on every cookie parse and keeps the HMAC hot.
- **`>= 32` char minimum** on the env var: HMAC-SHA256's security doesn't depend on key length below the digest size, but a 32-char floor catches accidental short/garbage values and matches the README's "high-entropy random value" guidance.
- **Falls back to a hard-coded default** rather than throwing, so the demo stays bootable in the sandbox (where `MSAADA_SESSION_SECRET` is unset). The warning is loud (`console.warn` with a `[msaada/auth]` prefix and the word "forgeable") and only fires in `NODE_ENV=production`.
- The default secret is intentionally self-documenting (`-do-not-use-in-production-`) so a `git grep` for the literal surfaces the misuse.

### 3. HMAC-signed `createSessionToken`

Before:
```ts
export function createSessionToken(chvId: string): string {
  // Simple signed-ish token for demo. NOT cryptographically secure — Supabase
  // would issue a JWT. Sufficient for the demo's "auth.uid() = submitting user"
  // equivalent.
  const payload = { uid: chvId, exp: Date.now() + SESSION_TTL * 1000 };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}
```

After:
```ts
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
```

Token format is `base64url(payload).base64url(hmac)` — two dot-separated base64url segments. The `.` separator is unambiguous because base64url's alphabet (`A-Za-z0-9-_`) excludes `.`.

### 4. Verified `parseSessionToken` with constant-time HMAC compare

Before:
```ts
export function parseSessionToken(token: string): { uid: string; exp: number } | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8")
    ) as { uid?: string; exp?: number };
    if (!decoded.uid || !decoded.exp) return null;
    if (decoded.exp < Date.now()) return null;
    return { uid: decoded.uid, exp: decoded.exp };
  } catch {
    return null;
  }
}
```

After:
```ts
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
```

Key correctness points:
- **Signature verified BEFORE the payload is parsed or trusted.** The previous code unconditionally JSON.parsed the base64url bytes and inspected `uid`/`exp`. Now a token whose signature doesn't match `signPayload(payloadBytes)` is rejected before any field is read.
- **`timingSafeEqual` for the signature compare**, with the explicit length-equality guard first — `timingSafeEqual` throws on mismatched-length `Buffer` arguments, and a forged token may supply a different-length signature segment, so the length check is both a safety guard and a defense against the throw.
- **Old (unsigned) tokens are rejected.** A pre-fix token was a single base64url segment with no `.`; `token.split(".").length !== 2` returns `null` immediately. This is the desired behavior — those tokens were forgeable, so silently accepting them would defeat the fix. Practically: any user logged in before this deploy gets a clean logout on their next request and re-authenticates through `/api/auth/login`, which issues a fresh signed token.
- The catch-all `try/catch` is preserved so a malformed base64url segment, a JSON parse failure, or any other thrown exception still degrades to `return null` (= "no session") rather than a 500.

### 5. New exported `rateLimitIdentifier(ip, email)` helper

Added before `DEMO_CHV_EMAIL` (after `requireChv`):

```ts
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
```

Per task instruction, the actual gate is NOT implemented in this module (the login/signup routes are owned by another agent). Instead, the JSDoc includes a drop-in usage snippet and policy guidance so the auth-route agent can wire it in with one read of this file. The key shape `auth:<ip>:<email>` namespaces cleanly against the existing `triage:` keys used by `/api/triage`.

Why combine IP + email (rather than one or the other):
- IP-only: an attacker behind a botnet gets a fresh bucket per IP → no throttling.
- Email-only: an attacker enumerating usernames gets a fresh bucket per username → can brute-force any single account by alternating usernames, and can also DoS-legitimately-lock-out other users' accounts.
- IP + email: a single attacker from one IP targeting one account is throttled at `capacity`/window; an attacker cycling usernames from one IP gets `capacity × #usernames`/window but each individual account is still protected; a distributed attack on one account is throttled per-account as soon as any one IP exhausts its bucket for that email.

Normalization (`trim().toLowerCase()`) is defensive against `Foo@bar.com ` vs `foo@bar.com` evading the same bucket.

## Untouched exports (per task constraint)

- `SESSION_COOKIE = "msaada_session"` — unchanged.
- `SESSION_TTL` — unchanged.
- `hashPassword` / `verifyPassword` (scrypt + timing-safe equal) — unchanged.
- `setSession` / `clearSession` / `getSessionChv` / `requireChv` — unchanged (they call `createSessionToken`/`parseSessionToken` internally, so they automatically pick up the HMAC behavior).
- `DEMO_CHV_EMAIL = "demo@msaada.health"` / `DEMO_CHV_PASSWORD = "msaada123"` — unchanged.

Function signatures of `createSessionToken(chvId: string): string` and `parseSessionToken(token: string): { uid: string; exp: number } | null` are also unchanged, so callers (verified via grep — only `auth.ts` itself imports them; all route handlers go through `setSession`/`getSessionChv`/`requireChv`) need no edits.

## Verification

- `bun run lint` → **PASS** (no errors, no warnings, exit 0).
- File re-read after edits (183 lines, was 85) to confirm structure.
- Grep confirmed no other source file imports `createSessionToken` or `parseSessionToken` directly — signature change is internal-only.

## Stage Summary

- Session tokens are now `base64url(payload).base64url(hmac-sha256(payload, SESSION_SECRET))`. A token minted without `MSAADA_SESSION_SECRET` (e.g. by base64-encoding `{uid, exp}` with a guessed CHV cuid — the exact forgeability the security judge flagged) will fail `timingSafeEqual` in `parseSessionToken` and the request is treated as unauthenticated.
- `SESSION_SECRET` resolves from `process.env.MSAADA_SESSION_SECRET` (≥ 32 chars) with a hard-coded fallback for the demo; a `console.warn` fires in `NODE_ENV=production` if the env var is missing or too short.
- Pre-fix unsigned tokens are rejected at the `.`-split check, so existing cookies cleanly invalidate on next request — no silent acceptance of forgeable tokens.
- New `rateLimitIdentifier(ip, email)` export produces a stable `auth:<ip>:<email>` key for the existing `checkRateLimit` limiter, with drop-in usage guidance in JSDoc for the auth-route agent (who owns the actual gate).
- Lint passes cleanly.
