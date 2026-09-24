# Msaada — Security + Resilience Review (Issues #1 + #2)

**Reviewer:** security-resilience auditor (read-only)
**Scope:** `src/app/api/community-reports/*`, `src/app/api/response-cases/*`, `src/lib/auth.ts`, `src/lib/pii-scrub.ts`, `src/lib/rate-limit.ts`, `src/app/api/triage/route.ts`, `src/lib/qwen.ts`, `src/app/api/invitations/*`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/signup/route.ts`, `src/app/api/dashboard/route.ts`, `src/app/api/audit/route.ts`, `prisma/schema.prisma`, `Caddyfile`.
**Method:** static read-only audit, no code changes.

---

## 1. Per-area scores (1–10, 10 = production-ready)

| Area | Score | Verdict |
|---|---|---|
| Auth & session management | **4/10** | Hardcoded fallback secret + no auth-state check at login + no login rate-limit. Demo-grade only. |
| PII scrubbing | **6/10** | Solid regex work (8 patterns, case-sensitive prefix re-validation), but only applied to `description`. Free-text fields bypass it. |
| Authorization / ownership (RLS equivalent) | **7/10** | Single-case PATCH/assign/encounter paths enforce ownership cleanly. List + single-fetch paths for community-reports lack county scoping. |
| Rate-limiting | **5/10** | Triage + public community-report POST are limited. Auth endpoints and AI-processing endpoint are NOT. Per-IP only (no per-account backstop). |
| Error handling / information leakage | **8/10** | 500 paths in triage / response-cases / encounter / assign all return generic messages; no `err.message` leak. Auth routes lack try/catch. |
| Resilience — Qwen unavailability | **9/10** | 2-attempt retry + spec-mandated fallback + policy engine routes fallback to `human_review`. Excellent. |
| Resilience — DB unavailability | **4/10** | Most API routes have try/catch; `auth/login` and `auth/signup` do NOT. Prisma errors propagate to Next's default handler. |
| Resilience — idempotency | **6/10** | Store pre-check + unique constraint exists, but a TOCTOU race is possible and the route catches via brittle message-regex instead of Prisma P2002. |
| Resilience — token expiry / suspension | **5/10** | Invitation expiry handled correctly. Suspended CHV login is NOT blocked at the auth boundary. |
| Audit trail integrity | **7/10** | Per-triage audit entries are well-shaped and de-identified. But `/api/audit` is unauthenticated, leaking the audit log to anyone. |

**Overall weighted score: 6/10** — Strong on defense-in-depth *inside* the triage flow (PII scrubber quality, policy engine determinism, fallback safety). Weak on the *boundaries* (auth, rate-limit coverage, county-scoping on the new community-reporting read paths). The gaps are concentrated, fixable, and **must** be closed before presentation.

---

## 2. Critical findings (with file:line)

### C1. Suspended / deactivated CHV can still log in
**File:** `src/app/api/auth/login/route.ts:34-39`
**Severity:** Critical
**Issue:** The login handler performs `findUnique({ where: { email } })` then `verifyPassword()`. It never inspects `chv.authState`. A user with `authState = "suspended"` or `"deactivated"` obtains a valid 7-day HMAC session token. The suspension check exists *only* in `/api/community-reports/[id]/process/route.ts:102` (CR-005 AI intake) — every other authenticated endpoint trusts the session. So a suspended CHV can still: read `/api/dashboard`, list `/api/community-reports`, list `/api/followups`, list `/api/response-cases`, read `/api/audit`, and submit `/api/triage` (which has its own rate-limit but no auth-state check).
**Judge-question trigger:** "A CHV was suspended at 10:00 after a safeguarding incident. Audit shows a triage submission at 10:30 from their account. How does your login boundary prevent this?"

### C2. No rate-limit on /api/auth/login and /api/auth/signup
**File:** `src/app/api/auth/login/route.ts` (entire file), `src/app/api/auth/signup/route.ts` (entire file)
**Severity:** Critical (for a mental-health platform handling PII)
**Issue:** `src/lib/auth.ts:172-179` exports a `rateLimitIdentifier(ip, email)` helper with extensive doc-comments ("Recommended auth policy (per the security judge's #1 risk item): 5 attempts / 60s per (ip, email) pair"). **Neither route calls `checkRateLimit`.** Combined with hardcoded demo credentials (`src/lib/auth.ts:181-182`: `demo@msaada.health` / `msaada123`), an attacker has a free brute-force path against any account. The signup route also returns `EMAIL_EXISTS` (line 63) — a clean email-enumeration oracle. `/api/invitations` (POST) and `/api/invitations/[token]` (POST) are likewise unthrottled, allowing invitation-token brute-force (mitigated only by 32-byte entropy, but still no IP throttle).

### C3. PII scrubber is bypassed for `landmark`, `directions`, `reporterName`, `reporterContact`
**File:** `src/app/api/community-reports/route.ts:142-182`
**Severity:** Critical (de-identification invariant violation)
**Issue:** Only `description` is passed through `scrubPII()` (line 168). The code comment (lines 137-141) says "PII scrubbing here focuses on the DESCRIPTION" and that landmark/directions "may legitimately contain coarse-area names" — but in practice CHVs and community members routinely write things like:
- `directions: "Plot 12, near Mama Wanjiru's shop, call 0712 345 678"` — contains plot number, kinship+name, phone number. All three match existing scrubber patterns. None applied.
- `landmark: "Opposite St. Mary's Primary School"` — contains a school name pattern. Not applied.
- `reporterName: "John Kamau"` — a real personal name. By definition PII. Not scrubbed.
- `reporterContact: "0712 345 678"` — a phone number. By definition PII. Not scrubbed.

These fields are then surfaced verbatim in `GET /api/community-reports` (line 277 returns `reports` with all fields), `GET /api/community-reports/[id]`, and the `ResponseCaseDTO` (`reportDescription`, `ward`, `landmark`, `directions` — `src/app/api/response-cases/[id]/route.ts:289-312`).
**De-identification invariant:** The README + worklog promise "raw free-text observation is NEVER persisted" and "the scrubbed text IS the persisted raw fact." Four fields break this promise.
**Mitigating factor:** `scrubNote()` exists in `src/lib/pii-scrub.ts:250-291` for follow-up notes (omits the 7-9 digit ID regex). It could be applied to `landmark`/`directions` with one-line changes.

### C4. Hardcoded fallback session secret — anyone with source can mint tokens
**File:** `src/lib/auth.ts:20-36`
**Severity:** Critical (production)
**Issue:** `DEFAULT_SESSION_SECRET = "msaada-demo-session-secret-do-not-use-in-production-8f3a9c2b7e1d"` (lines 20-21). `resolveSessionSecret()` (lines 23-36) logs a warning in production if the env var is missing or short, but **still returns the hardcoded value** — it does not throw. Anyone reading the source (the repo is public at github.com/Roy-Wanyoike/msaada per worklog) can compute `createHmac("sha256", DEFAULT_SESSION_SECRET).update(payloadJson).digest("base64url")` for any chosen `{uid, exp}` and mint a valid session for any CHV/supervisor/admin ID. The token format is `base64url(payload).base64url(hmac)` — trivial to forge.
**Mitigating factor:** Demo context. But the comment "Don't throw — keep the demo bootable" makes this a presentation landmine if a judge runs the deployed instance without setting the env var.

### C5. `/api/community-reports` GET (list) and `/api/community-reports/[id]` GET lack county scoping
**File:** `src/app/api/community-reports/route.ts:234-285`, `src/app/api/community-reports/[id]/route.ts:17-44`
**Severity:** High (cross-tenant data leak)
**Issue:** Both routes require a session (`getSessionChv`) but do NOT check role or county. The store's `getReports()` (`src/lib/community-report-store.ts:70-98`) has no `county` filter applied from the session — only from the query string. A CHV in Kilifi can `GET /api/community-reports?county=Nairobi` and read all Nairobi concerns (descriptions, reporterName, reporterContact, landmark, directions — the very fields C3 leaves unscrubbed). The single-fetch path has the same hole: `getReport(id.trim())` returns any row by ID. The schema even has the right index (`@@index([county, createdAt])`) — the route just doesn't use it for scoping.
**Contrast:** `/api/response-cases` (line 66-69 of `route.ts`) correctly branches on `SUPERVISOR_ROLES` vs CHV. `/api/triage-store.ts`'s `getMyFollowUps` is correctly scoped by `chvId`. The community-reports GET paths were not given the same treatment.

### C6. `/api/audit` and `/api/dashboard` are unauthenticated
**File:** `src/app/api/audit/route.ts:1-48`, `src/app/api/dashboard/route.ts:35-82`
**Severity:** High (information disclosure)
**Issue:** `/api/audit` returns paginated audit entries — `actorId` (cuid), `event` (triage_classified / crisis_override / fallback_used), `county`, `ward`, `classification`, `escalation`, `policyVersion`, `workflowClass`, `referralId` — to anyone. The route comment (lines 19-21) admits "TODO (production): require a compliance-officer role (RBAC). Currently open for the demo so judges can inspect the audit trail." `/api/dashboard` returns all-county aggregate stats + an 8-entry de-identified audit strip without auth. The aggregate-only mitigation is real (no raw observation text), but at small county scale (e.g. Turkana Central with 4 CHVs), aggregate counts + actor labels are re-identifiable. Mental-health audit data should never be world-readable.

### C7. PII scrubber regex gaps
**File:** `src/lib/pii-scrub.ts`
**Severity:** Medium
**Gaps:**
- (a) **Standalone proper nouns are not redacted.** Only kinship-prefixed names (`mama X`, `baba X`) and school-keyword-prefixed names are caught. A sentence like "Wanjiru looked despondent" or "I spoke with John Kamau" goes through unchanged. The system relies on the CHV always using kinship prefixes — not enforceable.
- (b) **No NHIF / insurance number pattern.** Kenya's NHIF membership number is 8 digits — coincidentally caught by `ID_RE`'s 7-9 digit run — but a SHIF number (newer scheme) is alphanumeric and would leak.
- (c) **No date-of-birth redaction.** "mtoto aliyezaliwa 2020-03-15" exposes a DOB. `ID_RE` deliberately skips 4-digit years.
- (d) **School regex requires keyword first.** "Mwangaza Primary School" (name first) does not match `SCHOOL_RE` — only "Primary Mwangaza" / "Shule ya Mwangaza" do. Common English word order is missed.
- (e) **International phone formats not matched.** Only Kenyan `+254` / `0` prefixes. A reporter's `+1 555 123 4567` (e.g. a diaspora reporter calling in a concern) leaks.
- (f) **Vehicle plate regex misses motorcycles** (3-digit + 1-letter, e.g. "KMEA 123A" is matched, but "KME 123A" old motorcycle format is matched, while county-less "MEA 123A" is not).

### C8. Session cookie missing `secure` flag
**File:** `src/lib/auth.ts:114-123`
**Severity:** Medium
**Issue:** `setSession` sets `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `maxAge` — but **not** `secure: true`. Behind Caddy (HTTPS-terminating), the cookie will still be sent on plain-HTTP requests if a user (or an attacker via redirect) hits an HTTP URL. The `Caddyfile` redirects nothing to HTTPS — it just reverse-proxies `:81 → :3000`. A presentation judge connecting to `http://...` would leak the session cookie over the wire.
**Mitigating factor:** `sameSite: "lax"` prevents most CSRF, and Caddy does set `X-Forwarded-Proto: {scheme}` — but the cookie itself has no `Secure` attribute.

### C9. Idempotency conflict catch is brittle (regex on Prisma error message)
**File:** `src/app/api/community-reports/route.ts:205-213`
**Severity:** Medium
**Issue:** The catch block detects idempotency conflicts by `if (err instanceof Error && /idempotencyKey/i.test(err.message))`. Prisma's `P2002` (unique constraint violation) error message format varies across database adapters and may not contain the literal column name in SQLite. The store's pre-check (`src/lib/community-report-store.ts:32-37`) handles the common case, but a TOCTOU race between two concurrent requests with the same `idempotencyKey` will both pass `findUnique === null` and one will hit the unique-constraint — surfacing as a 500 `REPORT_CREATE_FAILED` instead of the intended 409 `IDEMPOTENCY_CONFLICT`. The fix is to inspect `err.code === "P2002"` (and `err.meta?.target` includes `idempotencyKey`) rather than message-regex.
**Resilience impact:** A duplicated client retry (network glitch) under load produces a 500, breaking the idempotency contract.

### C10. `/api/auth/login` and `/api/auth/signup` have no try/catch — DB unavailability leaks a stack
**File:** `src/app/api/auth/login/route.ts:13-55`, `src/app/api/auth/signup/route.ts:21-89`
**Severity:** Medium (resilience)
**Issue:** Unlike `/api/triage` and `/api/community-reports` which wrap their handler bodies in `try { ... } catch (err) { console.error(...); return NextResponse.json({ error: "INTERNAL" }, { status: 500 }); }`, the auth routes let Prisma errors propagate. If the SQLite file is locked or the DB process is down, `db.chvUser.findUnique` throws → Next.js's default error page renders (in dev: stack trace; in prod: generic 500 page, but no JSON body, breaking the client contract). All other mutating routes (`response-cases/[id]`, `assign`, `encounter`, `followups/[id]`) DO have this guard — auth was skipped.

---

## 3. What a judge would ask — 5 tough security questions

**Q1.** "A CHV was suspended at 10:00 AM following a safeguarding incident. Your audit log shows a triage submission from their account at 10:30 AM. Walk me through exactly which line of code in `/api/auth/login` would have blocked the re-issue of their session, and which endpoints after login would have rejected the 10:30 AM triage POST."
> Current answer: **none.** Login doesn't check `authState`; `/api/triage` doesn't check `authState`; only `/api/community-reports/[id]/process` does (line 102). The judge will land this punch.

**Q2.** "You state the raw free-text observation is **never persisted** and that the scrubbed text *is* the persisted raw fact. The public community-report POST accepts `description`, `landmark`, `directions`, `reporterName`, `reporterContact` as free text from an unauthenticated stranger on the internet. For each of those five fields, tell me: is it scrubbed before persistence? Where in the code? And if not, why does `directions` (where CHVs routinely write 'Plot 12, near Mama Wanjiru's shop, call 0712 345 678') get a free pass?"
> Current answer: only `description` is scrubbed. The other four leak.

**Q3.** "Your rate-limit is a per-IP token bucket. An attacker behind a botnet of 10,000 residential proxies submits 50 reports/sec per IP from each of them — that's 500,000 reports/sec, all of which call `db.communityReport.create`. Walk me through what stops your SQLite write path from saturating, and what backstop catches the botnet that the IP rate-limit can't. Where is the per-account backstop you mentioned in `auth.ts:168-170`?"
> Current answer: there is no per-account backstop and no DB-write throttle. The botnet wins.

**Q4.** "Your HMAC session secret is hardcoded in `src/lib/auth.ts:21`. The repository is public (github.com/Roy-Wanyoike/msaada). Show me the line of code that prevents me, right now, from computing `HMAC-SHA256(DEFAULT_SESSION_SECRET, {uid: <your admin's cuid>, exp: <future>})` and gaining admin access to your deployed instance."
> Current answer: there is no such line. `resolveSessionSecret()` warns but does not throw.

**Q5.** "A CHV in Kilifi county opens `/api/community-reports` and sees a list of concerns filed in Nairobi. They pick one, fetch `/api/community-reports/{id}`, and read the description + landmark + directions + reporterContact. Which row of which query in `src/lib/community-report-store.ts` enforced that they could only see Kilifi data?"
> Current answer: none. The store's `getReports()` only filters by query-string `county`, not the session's county.

---

## 4. Specific fixes needed before presentation (ordered by impact)

### P0 — Must-fix before any judge/demo sees the system

1. **Add `authState` rejection to `/api/auth/login`** (C1).
   ```ts
   // src/app/api/auth/login/route.ts, after verifyPassword check
   if (chv.authState && chv.authState !== "active") {
     return NextResponse.json({ error: "ACCOUNT_NOT_ACTIVE" }, { status: 403 });
   }
   ```
   Also add the same guard to `/api/triage` POST and `/api/followups` PATCH (currently trust the session).

2. **Add rate-limiting to `/api/auth/login` and `/api/auth/signup`** (C2). Use the helper that already exists:
   ```ts
   // /api/auth/login/route.ts, top of POST
   const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
   const rl = checkRateLimit(rateLimitIdentifier(ip, email), { capacity: 5, windowMs: 60_000 });
   if (!rl.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } });
   ```
   Consider also throttling `/api/invitations` POST and `/api/invitations/[token]` POST.

3. **Apply `scrubNote()` to `landmark` + `directions` and `scrubPII`-lite to `reporterName`** (C3). The functions already exist:
   ```ts
   // src/app/api/community-reports/route.ts
   const landmarkTyped = ... ? scrubNote(landmark.trim().slice(0, 500)) : undefined;
   const directionsTyped = ... ? scrubNote(directions.trim().slice(0, 1000)) : undefined;
   const reporterNameTyped = ... ? scrubPII(reporterName.trim().slice(0, 200)).redacted : undefined;
   ```
   Decision needed on `reporterContact`: scrub phone digits to `[PHONE]`? But then supervisors can't follow up. Resolution: persist encrypted, decrypt only for the assigned CHV — out of MVP scope. For the presentation: store as-is, BUT do NOT return `reporterContact` in list responses — only in the single-fetch response to the assigned CHV/supervisor.

4. **Hard-fail the session secret in production** (C4):
   ```ts
   // src/lib/auth.ts, resolveSessionSecret
   if (process.env.NODE_ENV === "production" && (!envSecret || envSecret.length < 32)) {
     throw new Error("MSAADA_SESSION_SECRET must be set to >=32 chars in production");
   }
   ```

5. **Add county scoping to `/api/community-reports` GET and `/api/community-reports/[id]` GET** (C5):
   ```ts
   // In GET (list): if the session role is "chv", force county=chv.county; supervisors see their county; admins see all.
   // In GET (single): after getReport, if chv.role === "chv" && report.county !== chv.county → 403.
   ```
   This is a ~15-line change and matches the documented "Postgres RLS equivalent" promise.

### P1 — Should-fix before presentation

6. **Add auth + RBAC to `/api/audit`** (C6): require login; restrict `county_admin`/`moh_officer`/`auditor` role to their county; `system_admin`/`moh_admin` see all.
7. **Add `secure: true` to the session cookie when `NODE_ENV === "production"`** (C8).
8. **Add try/catch to `/api/auth/login` and `/api/auth/signup`** (C10): wrap the handler in `try { ... } catch (err) { console.error(...); return NextResponse.json({ error: "INTERNAL" }, { status: 500 }); }`.
9. **Replace message-regex with Prisma P2002 code check** (C9):
   ```ts
   // src/app/api/community-reports/route.ts
   import { Prisma } from "@prisma/client";
   ...
   if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
     return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
   }
   ```
10. **Tighten the PII scrubber** (C7): add NHIF/SHIF patterns, DOB (YYYY-MM-DD) redaction, standalone proper-noun detection after keywords (`jina`, `name`, `aitwa`, `called`), international-phone fallback. At minimum, add a `scrubNote` pass for `directions` regardless of the field-level decision in fix #3.

### P2 — Production-hardening (post-presentation)

11. **Shorten session TTL** from 7 days to ~8 hours; implement server-side session revocation (a `revoked_tokens` table or moving to JWT-with-jti + denylist). A 7-day irrevocable HMAC token is too long for a mental-health platform.
12. **Disable `/api/demo-chv` and `/api/seed` in production** via feature flag (`if (process.env.NODE_ENV === "production") return 404`).
13. **Encrypt `reporterContact` at rest** (SQLite SEElite / app-level AES-GCM with a KEK in env). The "operational follow-up" use case is legitimate, but plaintext PII in a SQLite file is not.
14. **Move rate-limit to Redis** (already documented in `src/lib/rate-limit.ts:9-11`) — single-instance Map won't survive horizontal scaling.
15. **Add CSRF token** for cookie-session state-changing routes. `sameSite: "lax"` mitigates most CSRF but not top-level-navigation CSRF. For a health platform, defense-in-depth is warranted.

---

## 5. Resilience summary — what happens when… (Issue #2)

| Failure mode | Current behavior | Verdict |
|---|---|---|
| **Qwen API unavailable** | `classifyObservation` retries twice, swallows errors, returns spec-mandated fallback `{escalation:false, classification:"needs_followup", fallbackUsed:true}`. Policy engine routes this to `human_review` workflow with `followUpRequired=true`. Triage record still persisted. Audit entry written with `fallbackUsed=true`. **Triaged observation is NOT lost — routed to caution.** | ✅ Excellent |
| **Duplicate community report** | If `idempotencyKey` provided: store pre-checks `findUnique` + unique constraint backstop. TOCTOU race surfaces as 500 (not 409) due to brittle message-regex catch. If `idempotencyKey` NOT provided: silently creates duplicate every time. | ⚠️ Partial |
| **Database unavailable** | `/api/triage`, `/api/community-reports`, `/api/response-cases/*`, `/api/followups/[id]` all catch and return generic 500. **`/api/auth/login` and `/api/auth/signup` do NOT catch** — Prisma errors propagate to Next's default handler; stack trace leaks in dev, opaque HTML 500 page in prod. | ❌ Auth gap |
| **Expired invitation token** | `/api/invitations/[token]` GET and POST both check `status === "revoked" \|\| new Date() > expiresAt` and return 410 `EXPIRED`. Clean. | ✅ Correct |
| **Suspended CHV tries to log in** | **Login succeeds.** Session issued. Subsequent calls to most endpoints succeed. Only `/api/community-reports/[id]/process` rejects. | ❌ Critical gap (C1) |
| **Rate-limit bucket exhaustion (per-IP)** | 429 with `Retry-After` header. Clean UX. | ✅ Correct |
| **AI-processing route called in a tight loop** | `/api/community-reports/[id]/process` has NO rate-limit. Each call invokes Qwen (cost + latency). A malicious CHV could exhaust the model budget. | ⚠️ Add per-CHV rate-limit on this path |
| **Concurrent case PATCH on the same case** | Pre-fetch + `updateCaseStatus` re-checks ownership; TOCTOU mapped to 409 `STATE_CONFLICT`. | ✅ Correct |
| **Concurrent encounter creation on the same case** | Pre-fetch checks `encounterId` is null; `updateCaseStatus` re-checks ownership atomically. If the case is reassigned mid-flight, returns 409 `CASE_STATE_CHANGED` — but the encounter row is **already created and orphaned** (no compensating delete). | ⚠️ Orphan encounter |
| **Signup email enumeration** | Returns 409 `EMAIL_EXISTS` for an existing email. Clean enumeration oracle. | ❌ Should return same response shape as success (send a "if this email is not registered, you'll get an email" type message) — but for a demo auth system, lower priority. |
| **Invitee accepts an already-accepted invitation** | Returns 410 `ALREADY_ACCEPTED`. Clean. | ✅ Correct |
| **Malformed JSON body** | All audited routes catch `await req.json()` throw and return 400 `INVALID_JSON` or `INVALID_CREDENTIALS` (login, no enumeration). | ✅ Correct |
| **NaN in pagination param** | `/api/audit` handles `Number.isFinite` guard. `/api/community-reports` uses `/^\d+$/.test()` regex guard. | ✅ Correct |

---

## 6. What's already strong (credit where due)

- **`/api/triage` 500 path** (lines 235-246): does NOT leak `err.message`. Returns generic `TRIAGE_FAILED` + static `detail` string. Server-side log retains the full error. ✅
- **`/api/response-cases/[id]` PATCH/assign/encounter**: all three wrap their bodies in try/catch returning `{ error: "INTERNAL" }`. ✅
- **HMAC token verification** (`src/lib/auth.ts:75-112`): uses `timingSafeEqual` with a length check first to avoid the timing-equality throw. Constant-time compare. ✅
- **PII scrubber regex quality** (the 8 patterns that DO exist): the case-sensitive prefix re-validation (Bug 2 fix), the M-Pesa ≥1-digit post-filter (Bug 1 fix), the new-plate-format fix (Bug 4), and the school-name space fix (Bug 3) show real attention to Kenyan context. The *patterns* are good; the *coverage* is incomplete (C7).
- **Policy engine separation** (`src/lib/policy-engine.ts`): pure function, no side effects, versioned, auditable. The crisis-override rule fires unconditionally on `escalation=true` — the AI cannot downgrade. ✅
- **Idempotency on AI intake** (`/api/community-reports/[id]/process:121-132`): 409 `ALREADY_PROCESSED` with the existing workflow class returned. Prevents re-running the model and masking a safety signal. ✅
- **Caddyfile XFF handling** (`Caddyfile:9`): `header_up X-Forwarded-For {remote_host}` — overrides client-supplied XFF, defeating IP-spoofing rate-limit bypass at the gateway. ✅ (Only relevant when the gateway is in the path.)

---

## 7. Top 5 findings (one-line each, for the final report)

1. **Suspended CHVs can still log in** — `/api/auth/login/route.ts` never checks `authState`; only the AI-intake route does. (C1)
2. **No rate-limit on auth endpoints** — `/api/auth/login` and `/api/auth/signup` are unthrottled despite a `rateLimitIdentifier` helper existing and being documented as "the security judge's #1 risk item." Combined with hardcoded demo credentials, brute-force is trivial. (C2)
3. **PII scrubber bypassed for 4 of 5 free-text fields** — `landmark`, `directions`, `reporterName`, `reporterContact` are persisted raw, breaking the documented "scrubbed text IS the persisted raw fact" invariant. (C3)
4. **Hardcoded fallback session secret** — `src/lib/auth.ts:20-21` warns but does not throw in production; anyone with source can mint admin tokens. (C4)
5. **Community-reports read paths lack county scoping** — any logged-in CHV (any county) can list and fetch all reports nationwide, including the unscrubbed `reporterContact` field. (C5 + C6)

**Resilience bright spot:** Qwen-unavailable handling is exemplary — 2-attempt retry + spec-mandated fallback + policy engine routes to `human_review`. No triaged observation is ever lost to a model outage.
