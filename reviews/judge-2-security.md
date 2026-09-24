# Judge 2 — Security & Compliance Review

**Reviewer:** security-judge
**Project:** Msaada (Next.js + Qwen CHV triage MVP, Kenya)
**Mode:** READ-ONLY audit of `worklog.md` + `README.md` claims vs. actual implementation in `/home/z/my-project/src`
**Date:** hackathon-judge pass

---

## Overall score: **5 / 10**

Solid *design intent* and clear thinking about the de-identification invariant — the
schema literally has no column for raw observation text, and the dashboard queries
are aggregate-only. But the *implementation* has one critical hole that breaks the
entire auth/RBAC/rate-limit story: **the session cookie token is forgeable**
(base64url JSON with no signature). Several other claims ("enforced in the
data-access layer", "audit trail = system of record for safety incidents") are
stronger than what the code actually delivers. For a clinical/mental-health
context with named households and suicide-ideation content, these gaps are
non-trivial even for a demo.

**Scorecard snapshot**

| # | Dimension | Score | Verdict |
|---|---|---|---|
| 1 | De-identification (raw text never persisted + scrubber coverage) | 7/10 | Core invariant holds; scrubber has real gaps; **follow-up `resolutionNote` is persisted un-scrubbed** — a live PII leak vector. |
| 2 | Access control / RBAC (ownership-scoped writes & reads; /dashboard, /audit, /supervisor gating) | 5/10 | Route-level scoping works, but data-layer claim is overstated; `/audit`, `/supervisor`, `/dashboard?scope=all` are **unauthenticated**. |
| 3 | Auth security (cookie-session, hashing, token forgery, expiry) | 3/10 | Scrypt hashing is good; **session token is plain base64 JSON — any user can impersonate any CHV**. No login rate limit, no `secure` flag. |
| 4 | Rate limiting (token bucket bypass, no-auth endpoints) | 4/10 | Bypassable via forged uids; **`/api/seed`, `/api/demo-chv`, `/api/auth/login`, `/api/auth/signup` have zero rate limit** — `/api/seed` calls Qwen 9× per request = cost DoS. |
| 5 | Audit trail (event coverage, write-failure handling, tamper-evidence) | 5/10 | Covers triage events; misses follow-up resolve, login, signup, dashboard access; **write is wrapped in `.catch()` so a crisis_override can be silently lost from the audit log**; no hash chain / tamper-evidence. |
| 6 | PII in logs | 8/10 | Standard log lines are de-identified (good). The `[qwen] attempt N error:` line can leak scrubbed observation text if the SDK error includes the request body. |
| 7 | Input validation | 6/10 | Whitelists for county/ward, parameterized Prisma queries, JSON parse guards. But **no max length on `observation_text` or `resolutionNote`**; follow-up note is free-text persisted un-scrubbed. |

---

## Per-dimension evidence

### 1. De-identification — 7/10

**What's solid**

- `prisma/schema.prisma:33-63` — `TriageRecord` has **no column** for raw observation text. A `SELECT *` on the table physically cannot leak the free text because it was never written. This is the right architectural choice and the README's "Layer 1" claim holds.
- `src/lib/triage-store.ts:16-49` — `insertTriageRecord` only persists model-derived structured fields + county/ward + submittedById. Verified end-to-end.
- `src/app/api/triage/route.ts:97-101` — the raw text is held in request memory, passed through `scrubPII()`, handed to `classifyObservation()`, and discarded. It is never echoed in the JSON response (route.ts:159 — `NextResponse.json(record, …)` returns only the DTO from `types.ts:48-62`, which has no `observation_text` field).
- `src/lib/triage-store.ts:361-475` — `getAggregateByCounty`, `getAggregateByDay`, `getAggregateByTag`, `getDashboardStats` all use `groupBy` and `select` only counts/date/classification/county/escalation/aggregateTag. They never select `observedIndicators`, `chpNextAction`, `chpInstruction`, or `confidenceNote`. The "aggregate-only VIEW equivalent" claim is true.
- `src/lib/triage-store.ts:584-670` — `getRecentAudit` and `getAuditPage` return `actorLabel: chv·${actorId.slice(-4)}`, never the raw `actorId` or email. The full `actorId` is selected from the DB but only the truncated form is in the API response. Good.

**Gaps**

- **Follow-up `resolutionNote` is persisted un-scrubbed.** `src/lib/triage-store.ts:228-252` — `resolveFollowUp` writes `resolutionNote: resolutionNote?.trim() || null` directly into the `FollowUp` table. The schema (`prisma/schema.prisma:99-121`) marks this field as `String?` and the seed comment at line 108 even admits "De-identified — the CHV is reminded not to include names/addresses." A reminder is not enforcement. A CHV typing *"Revisited Wanjiru at Plot 123 in Kwa Njenga — she's improving"* leaks a household name + plot + area into the DB un-scrubbed, and that text is then rendered in `PendingFollowUps.tsx`. **This is a real PII leak vector that violates the README's "Defense layer 2 — PII scrubber before the model" promise at a different stage of the workflow.**
- **The scrubber runs only before the model, not after.** If Qwen echoes a name back in `observed_indicators` (e.g. `"Wanjiru reports poor sleep"`), that string is persisted to the DB un-scrubbed (`triage-store.ts:33-35`). The scrubber doesn't post-process model output. Plausible for an LLM to do, and once it's in the DB it's in the CHV's own record and could surface via `/api/records/mine`.
- **Scrubber coverage gaps in `src/lib/pii-scrub.ts`:**
  - The kinship regex (`KINSHIP_NAME_RE`, line 60) requires a kinship word (`mama|baba|mtoto|dada|ndugu|shangazi|mjomba|nyanya|babu`) *before* a capitalized name. **Bare proper nouns are NOT redacted** — "Wanjiru amelala vizuri" or "John is withdrawn" goes to the model verbatim.
  - No KRA PIN (11 digits + letter), NHIF/NSSF number, passport (letter + 7 digits), refugee/alien number, IP address, or URL patterns.
  - M-Pesa paybill/till numbers (the 5-7 digit business codes used daily in Kenya) are not covered — only transaction confirmation codes (the 10-char uppercase kind).
  - Vehicle plate regex `K[A-Z]{2}\s?\d{3}[A-Z]?\d?` covers current generation but not the older `KXX XXXX` 7-char format without the trailing letter, and not motorcycle CD/CEA formats.
  - The `ID_RE` matches 7-9 digit runs — solid for the 8-digit Kenyan national ID, but it will also redact ages like 12345678 (rare) and will NOT catch IDs written with separators ("1 2 3 4 5 6 7 8").
- **No max length on `observation_text`.** `src/app/api/triage/route.ts:69-74` validates ≥10 chars but no upper bound. A CHV (or attacker with a forged session — see §3) can submit megabytes of text → Qwen cost/timeout DoS.

### 2. Access control (RBAC) — 5/10

**What's solid**

- `src/app/api/records/mine/route.ts:16-31` — `getMyRecords(chv.id, limit)` is filtered `where: { submittedById }` (`triage-store.ts:102-106`). A CHV cannot read another CHV's records via this endpoint.
- `src/app/api/stats/mine/route.ts:16-21` — `getMyStats(chv.id)` is similarly scoped.
- `src/app/api/followups/route.ts:17-31` — `getMyFollowUps(chv.id, …)` is scoped by chvId.
- `src/lib/triage-store.ts:228-252` — `resolveFollowUp` **does** perform an ownership check at the data layer: `if (!existing || existing.chvId !== chvId) return null;` This is the one function where the data-layer RBAC claim actually holds.
- `/api/dashboard` county-scoping (`src/app/api/dashboard/route.ts:49-59`) works *when a CHV session exists and `scope=mine` is passed*. `getDashboardStatsForCounty(chv.county, days)` filters every query by county.

**Gaps**

- **`insertTriageRecord` does NOT enforce ownership at the data layer.** `src/lib/triage-store.ts:16-49` accepts `submittedById` from the caller and persists it verbatim. The README claims (lines 55-62): *"In this Prisma adaptation it's enforced in the data-access layer (`requireChv()` → `submittedById = chv.id`)"* — but `requireChv()` is called in the **route**, not in `insertTriageRecord`. The data-access function itself has no enforcement; any future caller that passes a different `submittedById` writes a record attributed to someone else. The "RLS equivalent" claim is overstated: today's RLS is enforced at the route layer, which is exactly the kind of leak the README argues RLS-at-the-data-layer prevents.
- **`createFollowUp` (`triage-store.ts:180-205`) accepts a `chvId` and `triageRecordId` without verifying they belong together.** If a caller passed `triageRecordId=<someone else's record>` + `chvId=<attacker's id>`, the follow-up would be created against the wrong triage. Today only `/api/triage` calls it with the just-inserted record's id and `chv.id`, so not exploitable now — but the data-layer invariant is weaker than implied.
- **`/dashboard` is fully open with no auth gate.** `src/app/dashboard/page.tsx:91-` calls `/api/dashboard?scope=all` by default; `src/app/api/dashboard/route.ts:49-59` returns all-county aggregates if no session or `scope=all`. The README admits this is a TODO (line 80: "County-level RBAC on `/dashboard` — currently no auth for the demo"), but for a security review this is a real exposure: **anyone on the internet can pull aggregate county-level triage breakdowns** including the count of crisis overrides per county.
- **`/audit` is fully open with NO authentication.** `src/app/api/audit/route.ts:22-39` — any client can paginate the entire audit trail, filter by county/event/escalation. The README flags this as a TODO, but it's the most sensitive compliance surface in the system and it's completely unguarded. Combined with the `actorId` stored in the DB column (only truncated on the API response — good), a patient external actor could still enumerate events and correlate timing.
- **`/supervisor/roster` is fully open with NO authentication.** `src/app/api/supervisor/roster/route.ts:20-33` — anyone can pull per-CHV aggregate activity, load, escalation counts, and county/ward for every CHV in the system. The truncated `chv·xxxx` label plus county+ward is **potentially re-identifying** in low-population wards (e.g. "chv·a3f2 · Turkana · Loima" may be one of a very small number of CHVs in Loima ward).
- The `/dashboard`, `/audit`, `/supervisor` **pages themselves are not gated** — they are client components (`"use client"`) that fetch from the open APIs. There's no server-side redirect to `/` if no session. The "role: county official / compliance officer / supervisor" labeling in the README (lines 125-131) is purely cosmetic.

### 3. Auth security — 3/10

**What's solid**

- `src/lib/auth.ts:16-28` — passwords are hashed with **scrypt** (16-byte random salt, 32-byte key, `timingSafeEqual` for verification). That's actually above the bar for a 3-hour hackathon; many production codebases still ship bcrypt-with-cost-10.
- `src/app/api/auth/login/route.ts:37-38` — generic `INVALID_CREDENTIALS` 401 on both unknown-email and wrong-password. No enumeration.
- Cookie is `httpOnly: true` + `sameSite: "lax"` + `path: "/"` + `maxAge: 7d` (`auth.ts:54-59`). `httpOnly` blocks XSS-based cookie theft.
- Session expiry IS enforced — `parseSessionToken` rejects tokens with `decoded.exp < Date.now()` (`auth.ts:44`).

**Gaps**

- **🔴 CRITICAL: the session token is forgeable.** `src/lib/auth.ts:30-36`:
  ```ts
  export function createSessionToken(chvId: string): string {
    const payload = { uid: chvId, exp: Date.now() + SESSION_TTL * 1000 };
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
  }
  ```
  This is plain base64url-JSON with **no signature, no HMAC, no server secret**. The inline comment even admits "NOT cryptographically secure." A single curl impersonates any CHV:
  ```bash
  TOKEN=$(printf '{"uid":"targetChvCuid","exp":%d}' $((($(date +%s)+86400)*1000)) | base64 -w0 | tr '+/' '-_' | tr -d '=')
  curl -b "msaada_session=$TOKEN" https://host/api/triage -d '{"observation_text":"…","county":"Kilifi"}'
  ```
  The `targetChvCuid` is a 24-char cuid — but the demo CHV's id is exposed via `/api/auth/me` after login, and any other CHV's truncated id (`chv·xxxx`) appears on the open `/api/audit` and `/api/supervisor/roster` pages, which leaks the last 4 chars of every active CHV's id. With 24-char cuids that's still a 2^160 brute-force per CHV — not trivially exploitable from outside, but **any logged-in CHV can read their OWN full cuid from `/api/auth/me` and then forge a session for it after logout**, and an insider/shoulder-surfer who sees a cuid once can forge sessions indefinitely. This single hole invalidates the "auth.uid() = submitting user" invariant that the entire RLS/RBAC/rate-limit/audit story rests on.
- **No `secure` flag on the cookie.** `auth.ts:54-59` sets `httpOnly` and `sameSite` but not `secure: true`. In production over HTTPS this is fine because the browser only sends it on HTTPS, but on any misconfigured deploy (Caddy without TLS redirect, a staging subdomain over HTTP) the session token traverses plaintext. Combined with forgeability, that's a session-stealing vector.
- **No login rate limit / lockout.** `src/app/api/auth/login/route.ts` has no `checkRateLimit` call. The demo password is `msaada123` — 9 chars, dictionary-derivable. Online brute force is unthrottled. (The /api/triage rate limiter is the only one in the codebase.)
- **No CSRF token.** `sameSite=lax` blocks cross-site POST forms, and the API uses JSON bodies that trigger CORS preflight, so practical CSRF risk is low — but a `sameSite=strict` choice or a CSRF token would be defensible for a clinical tool.
- **Logout is just cookie deletion** (`auth.ts:62-65`). Since the token is stateless, a leaked token (e.g. from an HTTP-mitm log or an XSS-token-leak-via-prototype-pollution) remains "valid" until its `exp` (7 days). No server-side revocation list. Acceptable for demo; not for prod.
- **Signup is open with no captcha.** `src/app/api/auth/signup/route.ts` — anyone can create unbounded CHV accounts. Combined with no rate limit, an attacker can fill the `ChvUser` table.

### 4. Rate limiting — 4/10

**What's solid**

- `src/lib/rate-limit.ts` — clean token-bucket implementation. Continuous refill, sweep of stale buckets every 5 min to bound memory, `_resetRateLimit()` test hook. The API is Redis-swap-ready (single `key` string).
- `src/app/api/triage/route.ts:46-55` — `checkRateLimit(\`triage:${chv.id}\`)` is keyed per CHV, returns 429 with `Retry-After` header. Good.

**Gaps**

- **The per-CHV bucket is bypassable via session forgery (see §3).** An attacker who can mint a fresh `uid` per request gets a fresh bucket each time → effectively unlimited triage submissions. The rate limiter assumes `chv.id` is a trustworthy, stable identifier derived from a signed session — which it isn't.
- **No rate limit on `/api/seed`** (`src/app/api/seed/route.ts:141`). This endpoint calls `classifyObservation(t.text)` **9 times per request** (one per synthetic transcript), each call hitting Qwen. An attacker with `curl -X POST https://host/api/seed` in a loop racks up Qwen API cost at 9× the loop rate. There's no auth, no rate limit, no idempotency guard (the seed endpoint will happily re-insert the demo CHV's transcripts again on every call — actually no, looking again at `ensureDemoChv` it's idempotent for the user but **not** for the records; each call adds 9 more rows). **This is the most practical cost-DoS vector in the project.**
- **No rate limit on `/api/demo-chv`** — open provisioning endpoint.
- **No rate limit on `/api/auth/login`** — see §3.
- **No rate limit on `/api/auth/signup`** — open account creation.
- **In-memory storage** (acknowledged) — a multi-instance deploy would have per-instance buckets, so the limit becomes `N × instances` per CHV. The README and code comment flag this; fine for single-instance demo.
- **No global backstop bucket.** If a forged-uid attacker generates uids at random, each gets its own bucket with capacity 10 — the system has no aggregate "1000 triage calls per minute from one IP" guard.

### 5. Audit trail — 5/10

**What's solid**

- `src/lib/triage-store.ts:555-581` — `writeAuditEntry` records `actorId`, `event`, `county`, `ward`, `classification`, `escalation`, `fallbackUsed`, and `piiRedactions` (the scrubber's count object, never the redactions themselves). Never the observation text. Schema (`prisma/schema.prisma:75-92`) matches.
- `src/app/api/triage/route.ts:130-147` — every triage writes one of three events: `triage_classified`, `crisis_override`, `fallback_used`. The event is differentiated correctly.
- The audit endpoint and supervisor roster both render `actorLabel: chv·xxxx`, not the raw id or email.

**Gaps**

- **Audit write is wrapped in `.catch()` and swallowed** (`src/app/api/triage/route.ts:144-147`):
  ```ts
  await writeAuditEntry({ … }).catch((e) => {
    console.error("[triage] audit log write failed:", e);
  });
  ```
  The comment says "Audit write failure must not fail the triage response." For routine triage that's defensible. For a `crisis_override` event it is **not**: a suicide-ideation case could be persisted to `TriageRecord` (with `escalation=true`) while the corresponding `crisis_override` audit row never lands. The audit trail then undercounts the most safety-critical event class. **For safety events, the audit write should be in the same DB transaction as the triage insert — or the request should fail.** Today the audit trail cannot be relied on as the "system of record for safety incidents" because rows can be silently dropped.
- **Coverage gaps.** The audit log captures only the three triage-classify events. It does NOT capture:
  - Follow-up creation (`createFollowUp` at `triage-store.ts:180` — no `writeAuditEntry` call).
  - Follow-up resolution (`resolveFollowUp` at `triage-store.ts:228` — no audit entry; a CHV marking a crisis follow-up as "done" leaves no trace in the audit log).
  - Auth events (login success/failure, signup, logout) — no audit trail at all. A brute-force attack on `/api/auth/login` is invisible.
  - Access events to the open `/api/audit` and `/api/supervisor/roster` endpoints — no log of who scraped the audit trail.
  The README claim that the audit trail is the "system of record for safety incidents" is only true for one phase of the incident lifecycle.
- **No tamper-evidence.** The `AuditLog` table is a regular Prisma model with `update`/`delete` available to any caller with DB write access. There's no hash chain (each row hashing the previous row's hash), no append-only signature, no WORM storage. An insider with DB access can `db.auditLog.delete({ where: { id } })` any row. The README's "system of record" framing implies tamper-evidence that the code does not provide.
- **`actorId` is stored in full** in the `AuditLog.actorId` column (only truncated on the API response). That's a cuid, not PII, but it means the audit table itself is not strictly de-identified at the column level — anyone with read access to the SQLite file can correlate every audit row with a CHV.

### 6. PII in logs — 8/10

**What's solid**

- Grep across `src/` finds 7 console statements. The two intentional info logs (`/api/triage/route.ts:151-157` and `/api/seed/route.ts:182-188`) emit only `id / county / ward / escalation / classification / fallback / scrubbed=<redactionCountJSON>`. **No observation text, no PII.** The route.ts:149 comment explicitly notes "De-identified log line — raw observation text never appears here." Good practice.
- The two `.catch()` error logs (`route.ts:123, 146`) log the caught error object's message, not the request body. In practice these are Prisma errors that don't include observation text.
- `/api/triage/route.ts:160-167` — the catch block does `const detail = err instanceof Error ? err.message : String(err)` and then returns it as `{ error: "TRIAGE_FAILED", detail }` to the client. The comment "Never include observation_text in the detail" is correct for the qwen path (qwen errors won't echo input) but **would leak if Prisma or downstream code threw an error whose message echoed a saved field** (e.g. a unique-constraint error on `aggregateTag`). Low-likelihood but worth flagging.

**Gaps**

- **`/src/lib/qwen.ts:172` — `console.error("[qwen] attempt", attempts, "error:", err)`** logs the raw error from `zai.chat.completions.create`. If the SDK throws an error whose `.message` includes the model's input (some OpenAI-compatible SDKs do this on validation errors), the **scrubbed observation text** (post-scrubPII, so PII should be gone, but behavioral content remains) lands in server logs. The scrubber does run first, so the worst case is leaked clinical-behavioral text, not identifiers — but in a crisis case that's still sensitive. The error object should be sanitized to `.message` only, or redacted before logging.
- No structured logger / no log levels. `console.log` + `console.error` go to stdout/stderr with no redaction framework. Production would want a winston/pino with a PII-redact transport.

### 7. Input validation — 6/10

**What's solid**

- `/api/triage` (`route.ts:66-90`) — `observation_text` type+min-length checked; `county` validated against the `COUNTIES` whitelist; `ward` validated against the per-county `WARDS` whitelist. All Prisma queries are parameterized — no string interpolation into SQL. The only raw SQL in the project is `/api/seed/route.ts:138` (`db.$executeRaw\`UPDATE TriageRecord SET createdAt = ${target} WHERE id = ${id}\``) — Prisma's tagged-template form parameterizes safely.
- `/api/auth/signup` (`route.ts:36-55`) — email regex, password ≥6 chars, fullName non-empty, county+ward whitelist. Email lowercased for case-insensitive uniqueness.
- `/api/auth/login` — type+non-empty checks, generic 401.
- `/api/dashboard` (`route.ts:37-44`) — `days` parsed with `parseInt` + `isNaN` check + `Math.min(90, …)`. `scope` treated as string.
- `/api/records/mine`, `/api/followups`, `/api/audit`, `/api/supervisor/roster` — all parse `page`/`pageSize`/`limit`/`days` with `parseInt` + `isNaN` + `Math.min` caps. The audit `county` and `event` filters are free strings used in Prisma `where` clauses (parameterized) — no SQL injection, but a malicious `county` filter just returns 0 rows (no leak).
- `/api/followups/[id]/route.ts` — `status` validated against `{done, missed}`; `id` from URL path used in `findUnique` (parameterized).

**Gaps**

- **No max length on `observation_text`.** `route.ts:69-74` — only ≥10 chars. No upper bound. A CHV (or attacker via forged session) can submit megabytes → Qwen context overflow / cost spike / DB write of a giant `observedIndicators` JSON if the model parrots it back. Add `observation_text.length <= 4000` (or whatever your model context allows).
- **No max length on `resolutionNote`.** `src/lib/triage-store.ts:245` and `src/app/api/followups/[id]/route.ts:33-42` — no length cap. Combined with §1's no-scrubber-on-note gap, a CHV can paste arbitrary PII-laden text into a follow-up resolution.
- **`/api/seed` accepts no input but mutates state** — there's no body validation concern, but it's a write endpoint exposed without auth.
- **`/api/audit` `county` and `event` filters are not whitelisted.** They're free strings; Prisma parameterizes so no injection, but a typo county="kilifi" (lowercase) returns 0 rows silently. Minor.
- **No request body size cap.** Next.js default is fine, but a documented limit (e.g. 100KB) for `/api/triage` would be defensible.

---

## Top 5 security risks (ranked)

1. **🔴 CRITICAL — Forgeable session token** (`src/lib/auth.ts:30-49`). Plain base64url JSON, no HMAC, no server secret. Anyone who knows a CHV's cuid (their own, after logout, or another's via shoulder-surfing) can mint a valid session cookie and impersonate that CHV indefinitely. This single hole breaks the auth/RBAC/rate-limit/audit-actor-binding story end-to-end. **Severity: Critical** — fix before any deploy beyond the local demo.
2. **🔴 HIGH — Unauthenticated, Qwen-calling `/api/seed` endpoint** (`src/app/api/seed/route.ts`). Anyone can `curl -X POST /api/seed` and trigger 9 Qwen chat completions per call. No auth, no rate limit, no idempotency on the records (each call adds 9 more rows). **Severity: High** — direct model-cost DoS and DB-growth attack.
3. **🟠 HIGH — Follow-up `resolutionNote` persisted un-scrubbed, no length cap** (`src/lib/triage-store.ts:245`, `src/app/api/followups/[id]/route.ts:33-49`). Real PII leak vector that bypasses the "Defense Layer 2 — PII scrubber" claim entirely. A CHV typing household names/plots into a resolution note writes them to the DB verbatim. **Severity: High** — direct PII persistence violating the never-store-PII invariant.
4. **🟠 HIGH — `/api/audit` and `/api/supervisor/roster` are fully unauthenticated** (`src/app/api/audit/route.ts:22-39`, `src/app/api/supervisor/roster/route.ts:20-33`). The full compliance audit trail and per-CHV activity roster are scrapable by anyone. The truncated `chv·xxxx` label + county + ward is re-identifying in low-population wards. **Severity: High** — compliance data exposure.
5. **🟠 MEDIUM — Audit write failure is silently swallowed for `crisis_override` events** (`src/app/api/triage/route.ts:144-147`). A suicide-ideation triage can be saved to `TriageRecord` without a corresponding `crisis_override` row in `AuditLog`. The "system of record for safety incidents" claim is broken precisely for the highest-severity event class. **Severity: Medium-High** — silent safety-incident undercounting.

Honorable mentions (not in top 5 but worth fixing): no login rate limit / no `secure` cookie flag; no max length on `observation_text`; PII scrubber misses bare proper nouns and several Kenyan identifier formats; the `[qwen] error:` log line can leak scrubbed text via SDK error messages; the "enforced in the data-access layer" RLS claim is overstated (it's enforced at the route layer for `insertTriageRecord`).

---

## What a judge would ask in Q&A — 5 tough questions

1. **"Your README says the cookie session is 'scrypt-hashed' and the data layer 'enforces RLS'. But `createSessionToken` in `src/lib/auth.ts:30` is plain base64url JSON with no signature. Walk me through what happens if I open devtools, copy my session cookie, base64-decode it, swap `uid` to another CHV's cuid, base64-encode it, and replay. Does your RBAC still hold?"**
   *(Expected honest answer: no — the entire auth/RBAC/rate-limit story relies on the session token being unforgable, which it isn't. The README's "documented swap path to Supabase Auth" is the only honest defense.)*

2. **"You claim the audit trail is the 'system of record for safety incidents.' But `writeAuditEntry` is wrapped in `.catch()` at `route.ts:144`. Show me the code path that proves a `crisis_override` event is **always** persisted to the audit log, or admit it can be silently dropped."**
   *(Expected honest answer: it can be silently dropped; the audit write should be in a DB transaction with the triage insert for safety events.)*

3. **"A CHV types 'Revisited Wanjiru at Plot 123, Kwa Njenga — she's improving' into the follow-up resolution note. Walk me through every byte of that string from the browser to the database. Does your PII scrubber see it? Where does it land?"**
   *(Expected honest answer: it goes straight into `FollowUp.resolutionNote` un-scrubbed, un-length-capped, and is rendered back in the UI. The scrubber only runs on the `/api/triage` observation_text path.)*

4. **"`/api/audit` and `/api/supervisor/roster` are completely unauthenticated. I'm a journalist covering Kenyan community health. How many `curl` calls does it take me to enumerate every CHV in your system, their county, ward, observation count, and escalation count? And given the `chv·xxxx` truncated labels, in a ward with 1-2 CHVs, am I effectively de-anonymizing them?"**
   *(Expected honest answer: yes; the truncated label + county + ward is re-identifying in low-population wards. The TODOs in the code are honest but the README still labels these as "Compliance officer" / "Supervisor" views, implying they're gated.)*

5. **"`/api/seed` is open and calls Qwen 9 times per request. I'm a script kiddie with a `while true; do curl -X POST …/api/seed; done`. What stops me?"**
   *(Expected honest answer: nothing. No auth, no rate limit, no idempotency. The model-cost DoS is fully exploitable today.)*

---

## Specific fixes needed before presentation

**Must-fix (blocks demo credibility):**

1. **Sign the session token.** Add an HMAC-SHA256 over `{uid, exp}` using `process.env.MSAADA_SESSION_SECRET` (32 random bytes). Verify on every request. 15 lines of code. Without this, every "RBAC enforced" claim is suspect.
2. **Move `/api/seed`, `/api/demo-chv` behind a one-time admin token** OR delete them and seed via a CLI script (`bun run db:seed`). They cannot stay open in any deploy that the judges can reach.
3. **Add the PII scrubber to `resolveFollowUp`'s `resolutionNote`** (and a 500-char length cap). Same for any future free-text field. Run `scrubPII(note)` before persisting.
4. **Cap `observation_text` at 4000 chars** in `/api/triage/route.ts:69-74`.
5. **Make the audit write co-transactional with the triage insert for `escalation=true` records** — fail the request if the audit row can't be written. (Use a Prisma `$transaction`.)

**Should-fix (defensible but embarrassing if asked):**

6. **Gate `/api/audit` and `/api/supervisor/roster` behind at least a session check** (any logged-in CHV can read them for the demo) — and add a real "compliance" / "supervisor" role flag on `ChvUser` for prod.
7. **Add a rate limit on `/api/auth/login`** (e.g. 5 attempts / 60s per IP) and `/api/auth/signup` (3 / 5min per IP).
8. **Set `secure: true` on the session cookie** in production (guarded by `process.env.NODE_ENV === "production"`).
9. **Sanitize the `[qwen] error:` log line** — log only `err.message` (or a hash), not the raw error object.
10. **Extend the PII scrubber:** bare proper nouns (capitalized words at sentence starts), KRA PINs, NHIF/NSSF, passport numbers, M-Pesa paybill/till numbers. Add a post-model pass that re-runs the scrubber over `observed_indicators` strings before persistence.

**Nice-to-have (acknowledge in Q&A):**

11. Add a hash-chain to `AuditLog` (each row stores `prevHash` = SHA256 of the previous row's id+createdAt+actorId+event+county). Detect tampering on read.
12. Add audit entries for `followup_resolved`, `login_success`, `login_failure`, `signup`, `dashboard_export` events.
13. Add a global IP rate-limit bucket as a backstop to the per-CHV bucket.
14. Add CSRF token (or move to `sameSite=strict`) for state-changing routes.

---

## Summary for the judges' table

- **Overall: 5/10.** The de-identification **architecture** is genuinely well-thought-out (no raw-text column, aggregate-only reads, ownership-scoped queries), and the password hashing is real scrypt. But the **auth is forgeable**, two endpoints (`/api/seed`, `/api/audit`, `/api/supervisor/roster`) are unauthenticated, and one PII scrubber claim (`resolutionNote`) is bypassed by a different code path. For a clinical context these are non-trivial. The team clearly **knows** what the right answer is — the README's "Production hardening (TODO)" list and inline comments admit most of these — but a judge will ding the gap between the confident prose and the actual code.
