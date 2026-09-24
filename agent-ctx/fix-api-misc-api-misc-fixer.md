# Work Record — fix-api-misc

- **Task ID:** fix-api-misc
- **Agent:** api-misc-fixer
- **Scope:** three files ONLY — `src/app/api/followups/[id]/route.ts`, `src/app/api/audit/route.ts`, `src/app/api/seed/route.ts.

## Context reviewed

- `/home/z/my-project/worklog.md` (architecture + 10 prior review rounds)
- `/home/z/my-project/reviews/audit-5-api.md` (API auditor; relevant rows: #10 `/api/audit` NaN crash, #13 `/api/followups/[id]` type-coercion + 404 conflation, #14 `/api/seed` unauth + unrate-limited — top-10 issues #1, #5, #6, #9)
- `/home/z/my-project/agent-ctx/fix-triage-api-triage-api-fixer.md` (prior agent's style — used the same work-record format)
- The three target route files + supporting libs (`@/lib/pii-scrub`, `@/lib/rate-limit`, `@/lib/triage-store`) and the `FollowUp` Prisma model.

All three audited gaps are now closed; no other files were touched.

## Fix 1 — `src/app/api/followups/[id]/route.ts`

### 1a. Top-level try/catch returning `500 { error: "INTERNAL" }`

The PATCH handler previously had no top-level try/catch. If `resolveFollowUp` threw (e.g. `{"resolutionNote": 123}` ⇒ `123?.trim()` TypeError inside the data-access layer), the route bubbled an unhandled 500.

Now: the entire handler body is wrapped in `try { ... } catch (err) { console.error(...); return NextResponse.json({ error: "INTERNAL" }, { status: 500 }); }`. The full `err` is logged server-side; only the opaque code `INTERNAL` reaches the client (no `detail` leak — matches the discipline established by the prior `fix-triage-api` agent).

### 1b. `resolutionNote` validation, cap, and PII scrub

Previously destructured as `resolutionNote?: string` (type-cast only) — a non-string body value reached `resolveFollowUp` and threw at `.trim()`.

Now:
- Destructured as `resolutionNote?: unknown`.
- If the field is `undefined`/`null` → no note (untouched path).
- If present but `typeof !== "string"` → `400 { error: "INVALID_NOTE", field: "resolutionNote" }`.
- If present + string → `.trim()`, then `.slice(0, 500)` (cap before scrubbing so the regex runs on bounded input), then `scrubPII(capped).redacted` (defense-in-depth — a CHV may type a household member's name into the free-text note). The scrubbed value is what reaches `resolveFollowUp`.

Imported `scrubPII` from `@/lib/pii-scrub` (same scrubber the `/api/triage` route uses on observation text — single source of truth for PII redaction).

`MAX_RESOLUTION_NOTE_LEN = 500` exported as a module const at the top of the file.

### 1c. 404 / 403 / 409 split (replacing `NOT_FOUND_OR_NOT_PENDING`)

The single `404 NOT_FOUND_OR_NOT_PENDING` previously conflated three distinct cases. Now the route pre-fetches the follow-up row (via `db.followUp.findUnique`, mirroring the import pattern used by `/api/seed`) before calling `resolveFollowUp`, and maps each case to a distinct status:

| Condition | Status | Error code |
|---|---|---|
| `existing` is `null` (id not in DB) | 404 | `NOT_FOUND` |
| `existing.chvId !== chv.id` (wrong CHV) | 403 | `FORBIDDEN` |
| `existing.status !== "pending"` (already done/missed) | 409 | `ALREADY_RESOLVED` |
| Pre-checks pass, but `resolveFollowUp` still returns `null` (TOCTOU race) | 409 | `ALREADY_RESOLVED` (safe mapping — the row is no longer pending regardless of who resolved it) |
| Any unexpected throw | 500 | `INTERNAL` |

`db` imported from `@/lib/db` (same import the `/api/seed` route already uses).

## Fix 2 — `src/app/api/audit/route.ts`

### 2a. NaN guard on `page` / `pageSize`

Previously: `page: page ? Number.parseInt(page, 10) : 1`. `?page=abc` ⇒ `parseInt("abc") === NaN` ⇒ `Math.max(1, NaN) === NaN` (actually the route didn't even call `Math.max` — it passed `NaN` straight to `getAuditPage`, which passed it to Prisma `skip: NaN` ⇒ unhandled 500).

Now: each param is parsed to a temp variable, then guarded with `Number.isFinite(parsed) && parsed > 0 ? parsed : <default>`. This catches `NaN`, `±Infinity`, zero, and negatives — all fall back to the default (`page=1`, `pageSize=25`). The data-access layer's existing max-100 cap on `pageSize` is unchanged (defense-in-depth preserved).

No try/catch was added — the route is a thin GET wrapper over `getAuditPage`, and the NaN guard removes the only known crash vector. A residual Prisma throw would surface as Next.js's default 500 (acceptable, no detail leak).

## Fix 3 — `src/app/api/seed/route.ts`

### 3a. Per-IP rate-limit (3 calls / 10 minutes)

Previously: `POST()` (no args), no rate-limit. Each call spawns 9 Qwen LLM calls (~2+ minutes of LLM compute) + 9 DB writes + 9 raw-SQL backdates — a CRITICAL cost-attack / DB-bloat vector per the auditor (top-10 issue #1).

Now: `POST(req: Request)`. The route keys a token-bucket on the request IP:
- IP extraction: `req.headers.get("x-forwarded-for") ?? "unknown"`, then `.split(",")[0].trim()` (the header is a comma-separated list when proxied through multiple hops — leftmost = originating client) — falling back to `"unknown"` if the header is missing or empty after trim.
- Bucket key: `seed:${ip}` (namespaced to avoid collisions with the `/api/triage` bucket key which uses `triage:${chvId}`).
- Capacity: 3, window: `10 * 60_000` ms (3 seed calls per 10 minutes per IP — generous for demo/judge flows but blocks spam).
- On limit exceeded: `429 { error: "RATE_LIMITED", retryAfter: <seconds> }` with a `Retry-After` HTTP header (mirrors the `/api/triage` 429 shape — single client-side convention).

The route remains unauthenticated (per the task: "Keep the route unauthenticated (demo) but add the rate-limit"). The existing inline TODO (`TODO (production): remove or gate behind admin auth.`) is still accurate — the rate-limit is a stopgap, not full RBAC.

Imported `checkRateLimit` from `@/lib/rate-limit` (the same in-memory token-bucket the `/api/triage` route uses — single source of truth for rate-limiting).

## Verification

- `bun run lint` → **PASS** (no errors, no warnings). Exit 0.
- File diffs verified by re-reading each route after edits:
  - `followups/[id]/route.ts` — 117 lines (was 58). New imports: `db`, `scrubPII`. New: `MAX_RESOLUTION_NOTE_LEN` const, top-level try/catch, `INVALID_NOTE` 400 branch, `NOT_FOUND`/`FORBIDDEN`/`ALREADY_RESOLVED` 404/403/409 branches, `INTERNAL` 500 catch.
  - `audit/route.ts` — 48 lines (was 39). No new imports. New: `parsedPage`/`parsedPageSize` temp vars + `Number.isFinite` guards feeding `safePage`/`safePageSize`.
  - `seed/route.ts` — 216 lines (was 196). New import: `checkRateLimit`. Changed: `POST()` → `POST(req: Request)`; new rate-limit block at the top of the function body before any DB work.

## Untouched logic (per task constraint — "Do NOT touch any other files")

- `src/lib/triage-store.ts` `resolveFollowUp` — unchanged (still does its own pre-fetch + ownership/pending checks + `.trim()`; the route now pre-fetches too to disambiguate the null return).
- `src/lib/pii-scrub.ts` — unchanged (consumed as-is).
- `src/lib/rate-limit.ts` — unchanged (consumed as-is; `checkRateLimit` already accepts `capacity` / `windowMs` opts so no extension was needed).
- All other API routes, the Prisma schema, and the client pages — unchanged.

## Stage Summary

- API validation hardened (followup note type/length enforced + PII-scrubbed; audit NaN crash closed).
- Seed DoS vector closed (per-IP 3/10min rate-limit; unauth demo preserved).
- 404/403/409 status semantics restored on followup resolve — clients can now distinguish "doesn't exist" / "not yours" / "already resolved".
- Lint passes cleanly.
