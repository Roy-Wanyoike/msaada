# API Contract & Validation Audit — Msaada

**Task ID:** audit-api
**Agent:** api-auditor
**Scope:** all 15 routes under `src/app/api/` + cross-check against client page.tsx + msaada components.
**Mode:** READ-ONLY — no code changes.

Routes audited:
1. `GET /api` (root)
2. `POST /api/triage`
3. `POST /api/auth/signup`
4. `POST /api/auth/login`
5. `POST /api/auth/logout`
6. `GET /api/auth/me`
7. `GET /api/dashboard`
8. `GET /api/records/mine`
9. `GET /api/stats/mine`
10. `GET /api/audit`
11. `GET /api/supervisor/roster`
12. `GET /api/followups`
13. `PATCH /api/followups/[id]`
14. `POST /api/seed`
15. `POST /api/demo-chv`

---

## 1. Per-route audit table

Legend: Auth = `none` / `session` / `optional` / `RBAC(role)`.

| # | Route | Method(s) | Auth | Request shape (validated) | Response shape (success) | Response shape (error) | Validation gaps | Rate-limit / RBAC | HTTP codes | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `/api` | GET | none | — | `{ message: "Hello, world!" }` | — (no error path) | N/A | none | 200 | Scaffold leftover — should be removed or replaced with API index/health. |
| 2 | `/api/triage` | POST | session | body `{ observation_text: string (trim ≥10), county: enum, ward?: string (must belong to county) }` | `TriageRecordDTO` (raw, unwrapped) | `{error}` 401, `{error, retryAfter}` 429, `{error, field?}` 400, `{error, detail}` 500 | (a) **No MAX length on `observation_text`** — 10MB body → slow regex scrub + heavy Qwen call. (b) **500 leaks `detail` (`err.message`)** which can include Prisma errors / internal path info; comment claims no observation_text but arbitrary `err.message` is not sanitized. | Per-CHV token-bucket 10/60s ✓. No role gating (CHV-only by design). | 200/400/401/429/500 — **should be 201 on create** (returns 200). | Best-validated route in the codebase. Single source of truth for triage writes + audit + follow-up side-effects. |
| 3 | `/api/auth/signup` | POST | none | `{ email: regex-tested, password: string ≥6, fullName: non-empty, county: enum, ward?: must belong to county }` | `{ chv: { id, email, fullName, county, ward } }` | `{error, field}` 400, `{error}` 409 EMAIL_EXISTS | (a) **No MAX on `password`** — scrypt is CPU/memory intensive; a 10MB password DoSes the process. (b) **No MAX on `email`/`fullName`/`ward`** — unbounded string storage. (c) `ward` empty-string → treated as `null` (correct) but **no length cap on the stored value**. | **No rate-limit** → mass-account creation / brute-force vector. | 200/400/409 — **should be 201 on create**. | Email is lowercased before lookup (good). |
| 4 | `/api/auth/login` | POST | none | `{ email: non-empty string, password: non-empty string }` | `{ chv: {...} }` | `{error}` 401 INVALID_CREDENTIALS (constant message — no enumeration ✓) | (a) **No MAX on `password`** — same scrypt DoS as signup. (b) `email` is `.trim().toLowerCase()` before lookup — but if `email` is whitespace-only, `email.trim().length === 0` short-circuits to 401. OK. (c) JSON parse failure → 401 (good, no enumeration). | **No rate-limit** → brute-force vector (mitigated by constant-message, but unlimited attempts). | 200/401. | Good no-enumeration discipline. |
| 5 | `/api/auth/logout` | POST | none (clears cookie) | — | `{ ok: true }` | — | None. | No rate-limit (stateless, low risk). | 200. | Minor shape inconsistency: `{ok:true}` vs `{success:true}` vs `{}` — pick one. |
| 6 | `/api/auth/me` | GET | optional | — | `{ chv: null }` OR `{ chv: { id, email, fullName, county, ward } }` | — (no error path) | None. | None (read-only session hydration). | 200. | Returns 200 with `chv: null` for unauthed (correct for SPA hydration). |
| 7 | `/api/dashboard` | GET | optional (soft RBAC) | query: `?days=<n>` (default 14, max 90, NaN-guarded ✓), `?scope=mine|all` (cast, only `"mine"` triggers county-scoping) | `{ byCounty[], byDay[], byTag[], totals, audit[], followUpStats, scope: { county, mode } }` | — (no try/catch — Prisma errors → 500 default Next.js response) | (a) **`?scope=<invalid>` silently falls through to all-county** — safe but undocumented. (b) `?days=-5` → `parsed > 0` fails → falls back to default 14 (silent). (c) **No validation on `audit`/`followUpStats` shape returned** — if either data-access function throws, the whole route 500s with no client-friendly error. | Soft RBAC: `scope=mine` requires session. All-county path is open (documented TODO). **No rate-limit**. | 200. | Most complex GET; the `audit`/`followUpStats` additions are non-fatal in spirit but the route has no try/catch so a single sub-query failure breaks everything. |
| 8 | `/api/records/mine` | GET | session | query: `?limit=<n>` (default 20, max 50, NaN-guarded ✓) | `{ records: TriageRecordDTO[] }` (wrapped) | `{error}` 401 | None. | Session ✓. Ownership-scoped at the data layer ✓. **No rate-limit**. | 200/401. | Missing `export const dynamic = "force-dynamic"` (only auth-reads need it but inconsistent with siblings). |
| 9 | `/api/stats/mine` | GET | session | — | `ChvStats` (raw, unwrapped — `{ total, routine, needs_followup, needs_facility_referral, escalation, last7d, prev7d, firstSubmission, countiesCovered }`) | `{error}` 401 | None. | Session ✓. Ownership-scoped ✓. **No rate-limit**. | 200/401. | Raw-object return (no wrapper) — inconsistent with #8 which wraps in `{records}`. |
| 10 | `/api/audit` | GET | **none** | query: `?page`, `?pageSize`, `?county`, `?event`, `?escalation=true` | `{ entries: AuditEntry[], total, page, pageSize }` | — (no try/catch — `?page=abc` → NaN → Prisma throw → 500) | (a) **`page`/`pageSize` parsed with `parseInt` but NOT NaN-guarded** — `?page=abc` ⇒ `Math.max(1, NaN) === NaN` ⇒ `skip: NaN` ⇒ Prisma throws ⇒ unhandled 500. (b) **No enum check on `county`/`event`** — invalid values silently return empty. (c) **No max on `pageSize`** at the route level (the data-access layer caps at 100 — defense in depth, OK). | **NO AUTH, NO RBAC, NO RATE-LIMIT** — anyone can read the full de-identified compliance audit trail. TODO acknowledges; ship-blocker for production. | 200 (only success path). | Highest-sensitivity endpoint with the weakest guardrails. |
| 11 | `/api/supervisor/roster` | GET | **none** | query: `?county`, `?days` (NaN-guarded ✓) | `{ rows: SupervisorChvRow[], totals: { chvs, total, escalations } }` | — (no try/catch) | (a) **No enum check on `county`** — invalid county silently returns empty. (b) **No auth, no RBAC** — anyone can enumerate per-CHV workload + escalation burden across the whole network. | **NO AUTH, NO RBAC, NO RATE-LIMIT**. TODO acknowledges. | 200 (only success path). | Same exposure class as `/api/audit`. |
| 12 | `/api/followups` | GET | session | query: `?status=pending|done|missed|all` (default pending), `?limit` (default 50, max 100, NaN-guarded ✓) | `{ followUps: FollowUpDTO[] }` (wrapped) | `{error}` 401 | (a) **`?status=<invalid>` is cast but not validated** — `getMyFollowUps` falls through to `status !== "all"` branch with the invalid string as the Prisma filter (returns empty — safe but silently swallows typos). | Session ✓. Ownership-scoped ✓. **No rate-limit** (read-only, low risk). | 200/401. | Status enum validation missing at route boundary. |
| 13 | `/api/followups/[id]` | PATCH | session | path `id`; body `{ status: "done"|"missed", resolutionNote?: string }` | `FollowUpDTO` (raw, unwrapped) | `{error}` 401, `{error}` 400 MISSING_ID, `{error, field}` 400 INVALID_STATUS, `{error}` 404 NOT_FOUND_OR_NOT_PENDING, `{error}` 400 INVALID_JSON | (a) **`resolutionNote` is type-cast but NOT runtime-validated** — `{"status":"done","resolutionNote":123}` ⇒ `123?.trim()` inside `resolveFollowUp` throws TypeError ⇒ unhandled 500 (no top-level try/catch). (b) **404 conflates 3 distinct cases** — not-found, not-owned (should be 403), already-resolved (should be 409). Client can't distinguish. (c) **No length cap on `resolutionNote`**. (d) `if (!id)` is dead code — Next.js route only matches when `[id]` segment is present. | Session ✓. Ownership-scoped ✓ (only assigned CHV can resolve). **No rate-limit** — a malicious CHV could spam PATCH on their own follow-up. | 200/400/401/404. Missing 403/409 distinction. | Most validation gaps of any route; the type-coercion bug is reproducible. |
| 14 | `/api/seed` | POST | **none** | — (no body) | `{ seeded: number, records: [{ id, county, classification, escalation }] }` | — (no try/catch) | None at the route level (no input). **But: the route is NOT idempotent at the record level** — each call creates 9 NEW records (only the demo CHV is upserted). The worklog claims "idempotent" but only `ensureDemoChv()` is idempotent. | **NO AUTH, NO RBAC, NO RATE-LIMIT** — anyone can spam this endpoint; each call = 9 Qwen LLM calls (~12-15s each = ~2+ minutes of LLM time) + 9 DB inserts + 9 raw SQL backdates. **Major resource-exhaustion + cost-attack vector.** | 200 (only success path). Should be 201. | Documented as TODO but this is the single highest-impact unauth endpoint in the project. |
| 15 | `/api/demo-chv` | POST | **none** | — | `{ email, password, chv: {...} }` | — (no try/catch) | Returns the demo password in plain text in the response body (by design — but the route is unauth so any caller can harvest the credentials). | **NO AUTH, NO RATE-LIMIT**. TODO acknowledges. | 200 (only success path). Should be 201 on first-create. | Idempotent at the CHV level (won't create duplicates) — lower severity than `/api/seed`. |

---

## 2. Cross-cutting findings

### 2.1 Response shape consistency — INCONSISTENT

The 15 routes use **4 different return conventions**:

| Convention | Routes |
|---|---|
| Raw DTO (no wrapper) | `/api/triage` → `TriageRecordDTO`; `/api/stats/mine` → `ChvStats`; `/api/followups/[id]` → `FollowUpDTO`; `/api` → `{message}` |
| Wrapped single-collection | `/api/records/mine` → `{records}`; `/api/followups` → `{followUps}`; `/api/auth/{signup,login,me}` → `{chv}`; `/api/auth/logout` → `{ok:true}` |
| Spread payload | `/api/dashboard` → `{...stats, audit, followUpStats, scope}` (no top-level key) |
| Paginated wrapper | `/api/audit` → `{entries, total, page, pageSize}` |

There is **no unified `{data, error}` envelope**. Clients must remember per-route conventions. The dashboard page already papers over this with `data.audit ?? []` / `data.followUpStats ?? null` defensive coalescing — a sign the contract is fragile.

### 2.2 Error response shape — INCONSISTENT (4 variants)

| Variant | Used by |
|---|---|
| `{error}` | most 401/404/409/429 paths |
| `{error, field}` | `/api/triage` 400, `/api/auth/signup` 400, `/api/followups/[id]` 400 INVALID_STATUS |
| `{error, detail}` | `/api/triage` 500 — **leaks `err.message`** |
| `{error, retryAfter}` | `/api/triage` 429 |

`detail` on the 500 path is the most concerning: `err.message` from Prisma, the Qwen SDK, or JSON parsing can include internal identifiers, table/column names, or — if a downstream function ever surfaces the input — observation text. The inline comment in the route explicitly says "Never include observation_text in the detail" but does not sanitize `err.message`.

### 2.3 Client ↔ API shape mismatches

I cross-checked every consumer:

| Client | Endpoint | Shape match? |
|---|---|---|
| `AuthCard` (`login`/`signup`/`demo-chv`) | `/api/auth/{login,signup}` + `/api/demo-chv` | ✓ reads `data.chv`, `data.error` |
| `SubmissionForm` | `/api/triage` | ✓ reads `data.retryAfter` for 429, `data.error` otherwise, casts to `TriageRecordDTO` |
| `MyRecentObservations` | `/api/records/mine?limit=15` | ✓ reads `data.records` |
| `MyImpactCard` | `/api/stats/mine` | ✓ reads raw `ChvStats` |
| `PendingFollowUps` | `/api/followups` + `/api/followups/[id]` | ✓ reads `data.followUps ?? []`; PATCH error reads `d.error ?? HTTP ${status}` |
| `DashboardPage` | `/api/dashboard?days&scope` + `/api/seed` + `/api/auth/me` | ✓ defensive `?? []` / `?? null` coalescing; reads `data.byCounty/byDay/byTag/totals/audit/followUpStats/scope` |
| `AuditPage` | `/api/audit?page&pageSize&county&event&escalation` | ✓ reads `{entries,total,page,pageSize}` |
| `SupervisorPage` | `/api/supervisor/roster?days&county` | ✓ reads `{rows, totals}` |
| `ReportPage` | `/api/auth/me` + `/api/stats/mine` + `/api/records/mine?limit=20` | ✓ reads each shape correctly |

**No client-side shape mismatches found.** The defensive `??` coalescing on the dashboard page is the only smell — it suggests the author anticipated the API shape drifting.

### 2.4 Routes that SHOULD be RBAC-gated but aren't

| Route | Required role | Current | Severity |
|---|---|---|---|
| `/api/audit` | compliance-officer | open | HIGH |
| `/api/supervisor/roster` | supervisor | open | HIGH |
| `/api/seed` | admin | open | CRITICAL (resource-exhaustion vector) |
| `/api/demo-chv` | admin / feature flag | open | LOW (idempotent, but leaks demo password) |
| `/api/dashboard?scope=all` | national/admin | open (documented TODO) | MEDIUM |

### 2.5 HTTP status code drift

Five POST routes create server-side state but return **200 instead of 201**:
- `/api/triage` (creates TriageRecord + AuditLog + FollowUp)
- `/api/auth/signup` (creates ChvUser)
- `/api/auth/login` (creates session — debatable, 200 is acceptable for "issue credential")
- `/api/seed` (creates 9 records)
- `/api/demo-chv` (creates ChvUser if missing)

REST convention: 201 Created for resource-creating POSTs. Minor but inconsistent.

### 2.6 Type-coercion risks (runtime, not just type-system)

| Route | Field | Risk |
|---|---|---|
| `/api/followups/[id]` | `resolutionNote` | `{"resolutionNote": 123}` ⇒ `123?.trim()` throws TypeError ⇒ unhandled 500 (no try/catch) |
| `/api/audit` | `page`, `pageSize` | `?page=abc` ⇒ `parseInt` returns `NaN` ⇒ `Math.max(1, NaN) === NaN` ⇒ `skip: NaN` ⇒ Prisma throw ⇒ unhandled 500 |
| `/api/triage` | `observation_text` | no MAX length — 10MB body passes validation, then runs through PII regex (slow on huge input) and is sent to Qwen (rejected upstream, but body-parse cost already paid) |
| `/api/auth/{signup,login}` | `password` | no MAX — scrypt on a 10MB password OOMs the process |
| `/api/auth/signup` | `email`, `fullName`, `ward` | no MAX — unbounded string storage in SQLite |

### 2.7 Missing try/catch on GET endpoints

Routes 7, 9, 10, 11, 12, 14, 15 have **no top-level try/catch**. Any Prisma error, NaN propagation, or unexpected throw results in Next.js's default 500 with a generic message — which is OK for security (no detail leak) but provides a poor client UX (the dashboard page does its own `throw new Error("HTTP ${status}")` and surfaces "Dashboard endpoint returned HTTP 500" with no retry-able context). Only `/api/triage` has a try/catch (and it leaks `detail`).

---

## 3. Top 10 API issues (ranked)

| Rank | Route | Issue | Severity | Fix sketch |
|---|---|---|---|---|
| **1** | `POST /api/seed` | Unauthenticated + unrate-limited. Each call spawns 9 Qwen LLM calls (~2+ min of compute) + 9 DB writes + 9 raw-SQL backdates. Caller can DoS the LLM budget and bloat the DB indefinitely. The route is also NOT idempotent at the record level (only `ensureDemoChv()` is). | **CRITICAL** | Gate behind admin auth OR a one-time bootstrap flag; add rate-limit; track "seeded" flag to refuse re-runs. |
| **2** | `GET /api/audit` | No auth, no RBAC, no rate-limit. Anyone can read the full compliance audit trail (de-identified but still sensitive incident metadata — who/when/where/verdict for every triage including crisis overrides). | **HIGH** | Require compliance-officer role; add rate-limit; sanitize/guard `page`/`pageSize` against NaN. |
| **3** | `GET /api/supervisor/roster` | No auth, no RBAC, no rate-limit. Anyone can enumerate per-CHV workload + escalation burden across the whole network (truncated CHV labels still allow correlation across calls). | **HIGH** | Require supervisor role; add rate-limit; validate `county` against COUNTIES enum. |
| **4** | `POST /api/triage` (500 path) | The catch block returns `{error:"TRIAGE_FAILED", detail}` where `detail = err.message`. Arbitrary `err.message` from Prisma / Qwen SDK / JSON parsing can leak internals (table names, query fragments, upstream API error bodies). The inline comment claims "Never include observation_text in the detail" but does not sanitize `err.message`. | **HIGH** | Replace `detail` with a server-side `errorId` (uuid) that maps to a server log line; return only `{error, errorId}` to the client. |
| **5** | `PATCH /api/followups/[id]` | `resolutionNote` is type-cast as `string` but not runtime-validated. `{"resolutionNote": 123}` ⇒ `123?.trim()` throws TypeError inside `resolveFollowUp` ⇒ unhandled 500 (no top-level try/catch). Reproducible by any authed CHV. | **MEDIUM** | Add `typeof resolutionNote === "string"` guard (and length cap); wrap route body in a try/catch. |
| **6** | `GET /api/audit` (NaN crash) | `?page=abc` ⇒ `parseInt("abc") === NaN` ⇒ `Math.max(1, NaN) === NaN` ⇒ `skip: NaN` ⇒ Prisma throws ⇒ unhandled 500. Same applies to `pageSize`. | **MEDIUM** | Replace `page ? Number.parseInt(page, 10) : 1` with a NaN-guarded helper; default on NaN. |
| **7** | `POST /api/auth/{signup,login}` | No MAX length on `password`. `scryptSync` on a 10MB password OOMs the Node process. No rate-limit → brute-force / mass-account-creation vector. | **MEDIUM** | Cap `password` at ~1KB; add rate-limit on `/api/auth/login` (e.g. 5/minute per IP) and `/api/auth/signup` (e.g. 3/hour per IP). |
| **8** | `POST /api/triage` (input bound) | `observation_text` validated for MIN 10 chars but **no MAX**. A 10MB body is regex-scrubbed (slow), then sent to Qwen (rejected upstream, but body-parse + scrub cost already paid). | **MEDIUM** | Cap at ~10KB (sufficient for any reasonable CHV observation); 413 if exceeded. |
| **9** | `PATCH /api/followups/[id]` (status conflation) | Returns 404 `NOT_FOUND_OR_NOT_PENDING` for three distinct cases: (a) follow-up id doesn't exist, (b) follow-up exists but belongs to another CHV, (c) follow-up exists + owned but already resolved. Client can't distinguish; (b) should be 403 Forbidden, (c) should be 409 Conflict. | **MEDIUM** | Split the `resolveFollowUp` null return into a typed result (`{status: "not_found"|"forbidden"|"already_resolved"}`) and map to 404/403/409. |
| **10** | All routes | Response shape inconsistency: 4 different conventions (raw DTO / wrapped single-collection / spread payload / paginated wrapper) and 4 error-shape variants (`{error}` / `{error,field}` / `{error,detail}` / `{error,retryAfter}`). No unified `{data}` or `{error, errorId}` envelope. Clients must remember per-route conventions; future client authors will mis-cast. | **LOW** | Adopt one envelope (e.g. `{data: T}` for success, `{error: string, errorId?: string, field?: string}` for errors) and migrate routes incrementally. |

### Honorable mentions (below top 10)

- `GET /api` (root) is a scaffold leftover returning `{message:"Hello, world!"}` — should be replaced with an API index or removed.
- `POST /api/auth/logout` returns `{ok:true}` — pick one success-key convention (`{success:true}` or `{}`).
- `POST /api/triage` and `POST /api/auth/signup` return 200 on create instead of 201.
- `GET /api/dashboard?scope=<invalid>` silently falls through to all-county (safe but undocumented).
- `GET /api/records/mine` is missing `export const dynamic = "force-dynamic"` (the other authed GETs have it).
- `POST /api/demo-chv` returns the demo password in the response body — by design but leaks to any unauthed caller.

---

## 4. Summary counts

- **Validation gaps:** 12 (unbounded inputs ×3 routes; NaN-crash ×1 route; type-coercion ×1 route; missing enum checks ×2 routes; missing MAX-length on password ×2 routes; status conflation ×1 route; missing try/catch ×7 routes)
- **RBAC gaps:** 5 (`/api/audit`, `/api/supervisor/roster`, `/api/seed`, `/api/demo-chv`, `/api/dashboard?scope=all`)
- **Shape mismatches (client ↔ API):** 0 (all clients consume their endpoints' shapes correctly — but the **API itself** is internally inconsistent across 4 conventions; the dashboard client's defensive `?? []` coalescing hints at fragility)
- **Critical-severity issues:** 1 (`/api/seed` unauth + unrate-limited + non-idempotent + LLM-cost-attack vector)
- **High-severity issues:** 3 (`/api/audit` open; `/api/supervisor/roster` open; `/api/triage` 500 `detail` leak)
- **Medium-severity issues:** 5
- **Low-severity issues:** 1 (+ honorable mentions)

---

## 5. Recommended next actions (priority order)

1. **Gate `/api/seed` behind admin auth or a one-time bootstrap flag** + add rate-limit + add a "seeded" guard. (CRITICAL — ship-blocker for any non-sandbox deployment.)
2. **Add RBAC + rate-limit to `/api/audit` and `/api/supervisor/roster`.** Validate `page`/`pageSize`/`county` against NaN/enums.
3. **Replace `/api/triage` 500 `detail` with an opaque `errorId`** mapped to a server log line. Sanitize `err.message` before it touches the response.
4. **Add type + length validation to `/api/followups/[id]` body** (`resolutionNote` must be a string ≤ N chars); split the 404/403/409 cases.
5. **Cap input lengths** on `/api/auth/{signup,login}` password (≤1KB) and `/api/triage` observation_text (≤10KB); add rate-limits on auth endpoints.
6. **Adopt a unified response envelope** (`{data}` for success; `{error, errorId?, field?}` for errors) — incremental migration starting with new routes.
7. Remove the scaffold `GET /api` root or replace with an API index/healthcheck.
