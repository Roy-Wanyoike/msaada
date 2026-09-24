# issues-9-10-12 — auth-security-fixer

## Scope

3 P0 auth vulnerabilities from `reviews/security-resilience-review.md`:

- **#9 / C1** — Suspended CHV login bypass: `src/app/api/auth/login/route.ts` never inspected `authState` after a successful password verification.
- **#10 / C2** — No rate-limit on `/api/auth/login` and `/api/auth/signup` despite the `rateLimitIdentifier` helper + `checkRateLimit` already existing.
- **#12 / C4** — `resolveSessionSecret()` warned but returned the hardcoded `DEFAULT_SESSION_SECRET` in production.

Files touched (exactly the three permitted):

- `src/lib/auth.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/signup/route.ts`

## Changes

### `src/lib/auth.ts` — Fix #12 (session secret)

`resolveSessionSecret()`:

- Unchanged: returns `MSAADA_SESSION_SECRET` when set and >=32 chars.
- Production branch: previously `console.warn` + returned `DEFAULT_SESSION_SECRET`. Now **throws** `new Error("FATAL: MSAADA_SESSION_SECRET must be set to a >=32 char string in production.")`. Boot refuses — no silent forgeable-secret path remains.
- Dev branch (`NODE_ENV !== "production"`): unchanged, returns `DEFAULT_SESSION_SECRET` so the demo / `bun run dev` keeps booting.

### `src/app/api/auth/login/route.ts` — Fix #9 + Fix #10 (login)

- Added imports: `rateLimitIdentifier` from `@/lib/auth`; `checkRateLimit` from `@/lib/rate-limit`.
- Order: parse JSON body → validate email/password shape → **rate-limit check** → DB lookup → password verify → **authState check** → setSession.
- Rate-limit key: `rateLimitIdentifier(ip, email.trim().toLowerCase())`. IP extracted via `req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()` (passed through to helper which has its own `?? "unknown"` fallback). Capacity 5 / windowMs 60_000, exactly as specified.
- On rate-limit exceeded: returns `429 { error: "RATE_LIMITED", retryAfter }` with `Retry-After` header. `retryAfter` clamped to a minimum of 1 second.
- After `verifyPassword` succeeds: `if (chv.authState && chv.authState !== "active")` returns `403 { error: "ACCOUNT_SUSPENDED" }`. Covers `invited | verification_pending | verified | credentials_created | device_registered | suspended | deactivated` — only `active` proceeds to `setSession`. Auth boundary closes the door for every downstream endpoint that trusts the session.
- No try/catch added (P1 — issue C10 in the review, out of scope for this task).

### `src/app/api/auth/signup/route.ts` — Fix #10 (signup)

- Added imports: `rateLimitIdentifier` from `@/lib/auth`; `checkRateLimit` from `@/lib/rate-limit`.
- Order: **rate-limit check** → parse JSON body → validate fields → DB queries → create.
- Rate-limit key: `rateLimitIdentifier(ip, null)` — IP-only, because the email may not exist yet (per task instruction). The helper normalises `null` email to `"unknown"`, producing `auth:<ip>:unknown`.
- Same `429 { error: "RATE_LIMITED", retryAfter }` + `Retry-After` header shape as login.

## Lint

`cd /home/z/my-project && bun run lint` → **exit 0**, no errors, no warnings (only the unrelated `.eslintignore` migration notice from before this task). No unused imports, no type errors.

## What is NOT fixed here

The review flagged additional auth-resilience items that are explicitly out of scope for this task (other agents / other task IDs):

- **C5** county-scoping on `/api/community-reports` GET paths — not in the allowed file list.
- **C6** unauthenticated `/api/audit` and `/api/dashboard` — not in the allowed file list.
- **C7 / C3** PII scrubber gaps + 4-of-5 free-text fields unscrubbed in community-reports POST — not in the allowed file list.
- **C8** session cookie `secure` flag — would require touching `setSession` in `src/lib/auth.ts`; the task only authorised the `resolveSessionSecret` change in this file. (The session-secret fix landed in the same file but the cookie-flag fix is a separate concern.)
- **C9** P2002 idempotency catch — community-reports route, not in scope.
- **C10** try/catch on auth routes — separate P1; auth boundary fixes (rate-limit + authState + secret) close the most-severe paths.

## Verification of the closed gaps

- **Q1 (judge question)**: A CHV suspended at 10:00 trying to log in at 10:30 hits the new `chv.authState !== "active"` guard at the auth boundary, gets `403 ACCOUNT_SUSPENDED`, no session issued. ✅
- **Q4 (judge question)**: An attacker with source access trying to mint a token in production finds `resolveSessionSecret()` throws on boot — there is no running instance with the forgeable secret. ✅
- **Brute-force backstop**: 6th attempt within 60s against `/api/auth/login` (any (ip, email) pair) or `/api/auth/signup` (any ip) returns `429 RATE_LIMITED` + `Retry-After`. ✅
