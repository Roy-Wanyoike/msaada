# Engineering & Architecture Judge Scorecard — Msaada

**Judge:** engineering-judge (judge-4-eng)
**Scope:** architecture, types, DB design, error handling, organization, testing, DevOps, tech debt
**Read-only review.** No code modified.

---

## Overall score: **7.0 / 10**

A disciplined, well-documented MVP that leans hard on defense-in-depth for the privacy/RLS invariant. Error handling is the strongest dimension; type-safety tooling and the testing story are the weakest. Two deployment-config red flags (`ignoreBuildErrors: true`, eslint rule disables) mean the project ships without a compile-time safety net — fixable in an afternoon, but a judge will absolutely ask about it.

---

## Per-dimension scores

### 1. Architecture separation — **8/10**

**Evidence (strong):**
- Clean three-layer split: `src/lib/` (domain + data-access), `src/app/api/*/route.ts` (HTTP), `src/components/msaada/` (presentation).
- The data-access layer `src/lib/triage-store.ts` is the documented RLS-equivalent boundary. `insertTriageRecord` (`:16-49`) requires `submittedById`; `getDashboardStats` (`:491-532`) issues `groupBy` queries that never `select` `observedIndicators` / `chpNextAction` / `confidenceNote` text. The comment block at `:5-14` is explicit about the Postgres VIEW equivalent.
- Domain logic is correctly confined to `lib/`: `qwen.ts`, `pii-scrub.ts`, `rate-limit.ts`, `auth.ts`, `db.ts`. Zero of these are imported by a component.
- Client/server boundary is correct everywhere: every API route file imports from `next/server` (15 files, verified via grep); every interactive component declares `"use client"` at line 1; `src/app/dashboard/layout.tsx` is a server component exporting only `metadata` so the page can stay client.
- `z-ai-web-dev-sdk` is confined to `src/lib/qwen.ts` — verified, no other file imports it. The Qwen API key never reaches the client.
- Prisma client is imported only in `lib/db.ts`, `lib/auth.ts`, `lib/triage-store.ts`, and the API routes — never in components.

**Evidence (weak):**
- `src/app/dashboard/page.tsx` is **859 lines** as a single client component, with `DashboardHeader`, `DashboardView`, `ChartCard`, `DashboardFooter`, `FreshnessBadge`, `SeedPromptBanner`, `ErrorState` all defined inline. Single-responsibility is violated at the file level even though the subcomponents are internally clean.
- `src/lib/auth.ts:77` exports `requireChv()` (throws `UNAUTHORIZED`) but **no file in the codebase imports it** — every route uses `getSessionChv()` + an inline `if (!chv) return 401`. Dead export.
- `src/app/api/route.ts` is a leftover "Hello, world" scaffold (`{ message: "Hello, world!" }`) — should be a real `/api/health` or removed.

### 2. Type safety — **6/10**

**Evidence (strong):**
- **Zero `any` usage** in the entire `src/` tree — verified with `rg ': any|as any|<any>| any\[\]|any\)'` returning "No matches found". Excellent discipline given the hackathon scope.
- Discriminated union `TriageModelOutput = CrisisResult | NormalResult` (`src/lib/types.ts:42`) with the `escalation` discriminator — clean.
- DTOs (`TriageRecordDTO` `:48-62`, `FollowUpDTO` `lib/triage-store.ts:119-135`, `DashboardPayload` `dashboard-helpers.ts:63-74`) are well-shaped and explicit about nullables.
- Boundary casts (`body as Partial<TriageRequest>` `api/triage/route.ts:66`, `county as County` `:79`) are defensive and follow runtime validation against `COUNTIES` / `WARDS` constants.

**Evidence (weak):**
- `tsconfig.json:14` explicitly sets `"noImplicitAny": false`. With `strict: true` this is a downgrade — function parameters can be implicitly `any`. Should be removed (default-true under `strict`).
- `eslint.config.mjs:12-44` disables `@typescript-eslint/no-explicit-any`, `no-unused-vars`, `no-non-null-assertion`, `ban-ts-comment`, `prefer-as-const`, `no-unused-disable-directive`, `react-hooks/exhaustive-deps`, `react-hooks/purity`, `no-console`, `no-debugger`, `no-empty`, `no-unreachable`. Combined, this strips almost every lint-time guardrail that catches runtime bugs.
- `next.config.ts:7` sets `typescript.ignoreBuildErrors: true` — `next build` will **not fail** on TypeScript errors. **Critical deployment red flag.**
- DTO duplication — the same interfaces are declared on both sides of the wire:
  - `DashboardStats` in `lib/triage-store.ts:477-489` AND `components/msaada/dashboard-helpers.ts:28-40`
  - `AuditEntry` in `lib/triage-store.ts:541-553` AND `dashboard-helpers.ts:43-54` (different fields even — lib has `actorLabel`, component has `actorLabel` + `triageRecordId`)
  - `FollowUpStats` in `lib/triage-store.ts:677-686` AND `dashboard-helpers.ts:66-73` AND `components/msaada/FollowUpKpiCard.tsx:8-15`
  - `FollowUpDTO` in `lib/triage-store.ts:119-135` AND `components/msaada/PendingFollowUps.tsx:29-44` (component copy widens `classification: string`, losing the `Classification` union)
  - `ChvStats` in `lib/triage-store.ts:255-269` AND `components/msaada/MyImpactCard.tsx:19-29` AND `app/report/mine/page.tsx:27-37`
  - Since these are structurally typed, TypeScript won't catch drift between the server-emitted shape and the client-consumed shape. Should be consolidated in `src/lib/types.ts` and imported on both ends.
- Type assertions (`as Classification` `lib/triage-store.ts:80`, `as FollowUpStatus` `:160`, `as County` `api/triage/route.ts:79`) are defensive (validated against the value list first), but the eslint `no-non-null-assertion` disable lets a future `!` slip through.

### 3. Database design — **8/10**

**Evidence (strong):**
- `prisma/schema.prisma` is clean and well-commented. The four-model design (ChvUser → TriageRecord → FollowUp; AuditLog parallel) is coherent.
- Indexes are well-targeted to the actual query patterns:
  - TriageRecord: `@@index([county, createdAt])` (composite — covers `getDashboardStatsForCounty`), `@@index([classification])`, `@@index([aggregateTag])`, `@@index([escalation])`. All four are used by the `groupBy` paths in `triage-store.ts`.
  - AuditLog: `@@index([createdAt])`, `@@index([actorId])`, `@@index([county])`, `@@index([event])`. Covers `getRecentAudit` (recent) + `getAuditPage` (filter by county/event).
  - FollowUp: `@@index([chvId, status])` (covers `getMyFollowUps` ownership-scope), `@@index([dueAt])` (covers overdue calc), `@@index([status])` (covers `getFollowUpStats` groupBy).
- `FollowUp.triageRecord` has `onDelete: Cascade` (`schema.prisma:113`) — follow-ups auto-cleaned when a triage record is deleted.
- `observedIndicators` stored as JSON-encoded `TEXT` (SQLite has no arrays) — documented in `schema.prisma:2-9` and decoded defensively with try/catch in `triage-store.ts:68-74`.
- All ids are `cuid()` (no `gen_random_uuid()` available in SQLite) — documented.

**Evidence (weak):**
- `AuditLog.triageRecordId` (`schema.prisma:78`) is `String?` but has **no `@relation` declared**. Referential integrity is not enforced at the DB layer — a deleted TriageRecord leaves dangling audit rows. (Intentional given the audit is meant to outlive the triage row, but worth documenting.)
- SQLite doesn't enforce FKs by default unless `PRAGMA foreign_keys=ON`, and Prisma doesn't auto-enable it for SQLite. The `onDelete: Cascade` is advisory.
- No index on `TriageRecord.ward` — current queries filter by `county` only, but a future ward-level RBAC would need it.
- `FollowUp.dueAt` index exists, but the overdue query in `getFollowUpStats` (`:717-722`) filters by `triageRecord.county` via a relation join — no composite index helps here. For a single-county dataset this is fine; at scale it'll table-scan.

### 4. Error handling & resilience — **9/10**

**Evidence (strong):**
- **Qwen retry + fallback** (`src/lib/qwen.ts:132-188`) is best-in-class:
  - Two-attempt loop with strict-format escalation on attempt 2 (`:153-174`).
  - `stripJsonFence` + first-brace/last-brace extraction (`:32-39, 91-110`) for malformed outputs.
  - `coerceNormal` / `coerceCrisis` (`:45-89`) validate every field type before trusting.
  - Spec-mandated fallback at `:176-187`: `classification: "needs_followup"`, `confidence_note: "model output could not be parsed, defaulting to caution"`. **Never silently drops a failed classification.**
  - The DTO surfaces `fallbackUsed` so the UI (`TriageResultCard.tsx:80-89`) shows an amber "Caution fallback applied" banner, and the audit log records the `fallback_used` event.
- **Audit-write non-fatal**: `api/triage/route.ts:130-147` wraps `writeAuditEntry()` in `.catch((e) => console.error("[triage] audit log write failed:", e))`. The comment explicitly says "Audit write failure must not fail the triage response."
- **FollowUp-write non-fatal**: same pattern at `:119-124`.
- **Backdate failure non-fatal**: `api/seed/route.ts:163-172`.
- **De-identified logging**: `api/triage/route.ts:151-157` logs only `county/ward/escalation/classification/fallback/scrubbed=redactionCount` — never the observation text. The comment at `:35-36` is explicit: "console logs after classification intentionally carry only county/ward/escalation/classification — never the free text."
- **Race-guarded client fetches**: `app/dashboard/page.tsx:111-133` uses a monotonic `reqIdRef` counter to drop stale responses.
- **Outer try/catch on every route** (`/api/triage`, `/api/seed`, `/api/auth/signup`, `/api/auth/login`, `/api/followups/[id]`) returns structured `{ error, field? }` JSON.
- **`parseSessionToken`** (`lib/auth.ts:38-49`) wraps JSON.parse in try/catch, checks exp, returns null on any failure — no token-validation crashes.

**Evidence (weak):**
- `api/triage/route.ts:160-168` outer catch returns `{ error: "TRIAGE_FAILED", detail }` where `detail = err.message`. Prisma error messages and DB-connection strings can leak to the client. Should be scrubbed to a generic message client-side; full message server-side only.
- No `db.$transaction` wrapping the triage+followup+audit triple in `api/triage/route.ts:101-147`. Three separate writes — if the audit fails (silently swallowed), the audit trail drifts from the triage records table. The comment at `lib/triage-store.ts:538` calls the audit table "the system of record for safety events" — a silent miss is a real compliance gap.
- The seed route's `db.$executeRaw\`UPDATE TriageRecord SET createdAt = ${target} WHERE id = ${id}\`` (`api/seed/route.ts:138`) is parameterized via Prisma's safe tagged templates — no SQL injection. ✓

### 5. Code organization — **7/10**

**Evidence (strong):**
- Components are mostly small and single-responsibility: `AuthCard` (352), `CrisisPanel` (148), `TriageResultCard` (157), `MyImpactCard` (243), `MyRecentObservations` (298), `AuditStrip` (147), `PendingFollowUps` (369), `AppNav` (106), `KpiCard` (110).
- Shared helpers are reused well: `dashboard-helpers.ts` exports `COLORS`, `TONE`, `formatDay`, `prettyTag`, `pct`, `weeklyDelta`, `computeInsights`, `proxyCountyWeeklyDelta` — consumed by `county-bar-chart`, `county-table`, `kpi-card`, `AuditStrip`, `insight-callouts`, `dashboard-states`, `FollowUpKpiCard`.
- The `AppNav` component (`components/msaada/AppNav.tsx`) is shared across `/dashboard`, `/audit`, `/supervisor`, `/report/mine`, `/settings` — single source of truth for the back-office navigation.
- API route handlers are uniformly structured: dynamic-export at top, JSDoc with auth/contract, validation, try/catch, NextResponse.json.

**Evidence (weak):**
- `app/dashboard/page.tsx` is 859 lines with 7 inline subcomponents. Should be split into `dashboard/DashboardHeader.tsx`, `DashboardView.tsx`, `ChartCard.tsx`, `DashboardFooter.tsx`, `SeedPromptBanner.tsx`. The page file should be just the orchestrator.
- Palette/tone style maps are duplicated across 5 files:
  - `dashboard-helpers.ts:80-126` (the canonical `COLORS` + `TONE`)
  - `kpi-card.tsx:18-47` (re-declared `TONE_CLASSES`)
  - `MyImpactCard.tsx:211-216` (`TONE_STYLES`)
  - `TriageResultCard.tsx:23-33` (`CLASS_BADGE_CLASSES`, `CLASS_RING_CLASSES`)
  - `report/mine/page.tsx:53-58` (`CLASS_TONE`)
  These should unify on the canonical `TONE` from `dashboard-helpers.ts`.
- The DTO duplication noted in §2 is also an organization smell — the contract has no single source of truth.
- `relativeTime` is duplicated in `MyRecentObservations.tsx:53-65` and `AuditStrip.tsx:46-55` (slightly different logic). Should extract to a shared util.

### 6. Testing strategy — **2/10**

**Evidence (weak):**
- No test code under `src/`. The `tests/` directory contains only two shell scripts (`database-runtime-build.sh`, `python-runtime-*.sh`) — the latter are scaffold leftovers unrelated to Msaada.
- No test runner in `package.json` (`vitest` / `jest` / `playwright` all absent). The `_resetRateLimit` export in `rate-limit.ts:80-82` and the `_name` unused params in `pii-scrub.ts` (e.g. `:135, 158`) hint that someone considered writing tests, then didn't.
- Spec/README is honest about this ("no test code") but a judge will still ask.

**What SHOULD be tested (ranked by ROI):**
1. **`qwen.ts::parseModelOutput` + `coerceNormal` / `coerceCrisis`** — pure functions, perfect for unit tests. Cases: clean JSON, code-fenced ```` ```json ````, prose-prefixed JSON, invalid JSON, missing fields, wrong types, crisis path, normal path, malformed `escalation`, single-letter-name kinship edge case.
2. **`pii-scrub.ts::scrubPII`** — pure regex coverage. Cases: phone formats (`+254 7XX`, `07XX`, `2547XX`), emails, M-Pesa codes, plot numbers, vehicle plates, school names, kinship+name patterns, single-letter name (should NOT redact), ages (should NOT redact), years (should NOT redact).
3. **`rate-limit.ts::checkRateLimit`** — pure (after `_resetRateLimit`). Cases: first request allowed, capacity exhaustion, refill timing, Retry-After calc, sweep of stale buckets.
4. **`triage-store.ts`** — integration tests against a test SQLite DB: `insertTriageRecord` writes the expected columns; `getDashboardStats` never selects indicator text (assert via raw SQL inspection); `getDashboardStatsForCounty` filters correctly; `getMyFollowUps` ownership-scope.
5. **`/api/triage` end-to-end** with a mocked `z-ai-web-dev-sdk`: crisis transcript → `escalation=true`; routine → `classification: routine`; unparseable model output → `fallbackUsed: true`; rate-limit exceeded → 429 + Retry-After; no session → 401.
6. **`CrisisPanel.tsx`** behavior: Escape blocked in capture phase; confirm button disabled for 5s; confirm enabled at countdown=0; `aria-modal`/`role="alertdialog"` set.

### 7. DevOps / deployment — **6/10**

**Evidence (acceptable):**
- `.env` exists: `DATABASE_URL=file:/home/z/my-project/db/custom.db`. Single env var (the SDK uses its own key path; no `OPENAI_API_KEY`-equivalent needed).
- `next.config.ts:5 output: "standalone"` — good for containerized deployment. `package.json` build script copies `.next/static` and `public` into the standalone bundle.
- Idempotent `ensureDemoChv` (`api/seed/route.ts:112-128`, `api/demo-chv/route.ts:20-33`) — `findUnique` then `create` if missing.
- `agent-ctx/` is empty (no leftover scratch). `.gitignore` excludes `db/`, `*.db`, `.env`, `upload/`, `*.log`, `*.png`.

**Evidence (weak):**
- **No `.env.example` file.** A new clone can't see what env vars are needed without reading the source.
- **`next.config.ts:7 typescript.ignoreBuildErrors: true`** — `next build` won't fail on TypeScript errors. **Critical.** Combined with the eslint disables, there is no compile-time safety net.
- `next.config.ts:9 reactStrictMode: false` — strict mode disabled, so double-rendering in dev won't catch side-effect bugs.
- `package.json:10` `db:push` uses `--accept-data-loss` — silently drops data on schema changes. OK for hackathon dev, dangerous if copy-pasted into prod.
- `db.ts:10` `log: ['query']` is **always on** (not gated on NODE_ENV). Verbose query logging in production.
- **`POST /api/seed` is NOT transcript-idempotent.** Only the demo-CHV provisioning is idempotent; every call appends 9 more records (no transcript hash / no `seedRunId` check). The dashboard's `autoSeedTriedRef` guard (`dashboard/page.tsx:108-109, 230-233`) prevents re-seeding on empty data, but a manual "Seed" click or a Cron re-invocation silently duplicates data and skews the dashboard aggregates.
- No `prisma/migrations/` directory — only `db:push`, no migration history. OK for MVP, problematic for prod.
- `tests/python-runtime-container.sh` and `tests/python-runtime-build.sh` are scaffold leftovers unrelated to Msaada.

### 8. Technical-debt indicators — **6/10**

**Evidence (acceptable):**
- 8 explicit TODOs, all in two honest categories: (a) RBAC roles for `/api/audit` (`:19`), `/api/supervisor/roster` (`:18`), `/dashboard` county-official (`dashboard/page.tsx:608`), `/api/seed` admin gate (`:36`), `/api/demo-chv` feature-flag (`:17`); (b) per-county weekly delta contract extension (`dashboard-helpers.ts:285`). All mirrored in the README's "Production hardening" section.
- No FIXMEs anywhere in `src/`.
- Voice-to-text is stubbed (`SubmissionForm.tsx:413`) — explicitly called out in the placeholder text.
- No commented-out code blocks.

**Evidence (weak):**
- `src/app/api/route.ts` is leftover scaffold "Hello, world".
- `requireChv()` exported from `lib/auth.ts:77-81` but never imported anywhere — dead export.
- **Confusing redundant ternary** at `lib/triage-store.ts:37`:
  ```ts
  chpNextAction: isCrisis ? null : (isCrisis ? null : output.chp_next_action)
  ```
  The inner ternary is **unreachable** — when `isCrisis` is `false` (the only branch where the inner ternary evaluates), the outer ternary already chose the second branch, so `isCrisis ? null : output.chp_next_action` always returns `output.chp_next_action`. The logic is *correct* but a reviewer will read it as a bug. Should collapse to `isCrisis ? null : output.chp_next_action`.
- ESLint rule disables (see §2) mean unused exports, dead imports, and `!`-assertions won't be caught.

---

## Top 5 engineering risks (ranked)

1. **`next.config.ts:7 typescript.ignoreBuildErrors: true` + eslint rule disables + `tsconfig.noImplicitAny: false`** — the project ships with **no compile-time safety net**. A future refactor could land broken types in production silently. Combined with no test suite (§6), runtime bugs in pure functions like `parseModelOutput` and `scrubPII` could ship undetected.

2. **DTO contract duplication across server/client** — `DashboardStats`, `AuditEntry`, `FollowUpDTO`, `FollowUpStats`, `ChvStats` are each declared twice (some three times) in `src/lib/triage-store.ts` AND `src/components/msaada/dashboard-helpers.ts` (and `PendingFollowUps.tsx`, `MyImpactCard.tsx`, `report/mine/page.tsx`). TypeScript won't catch drift because the duplicates are structurally typed but separately declared. The `FollowUpDTO` in `PendingFollowUps.tsx:29-44` widens `classification: string`, losing the `Classification` union — drift has already begun.

3. **No tests + no test runner** — `vitest`/`jest` absent from `package.json`. `qwen.ts::parseModelOutput`, `pii-scrub.ts::scrubPII`, and `rate-limit.ts::checkRateLimit` are pure functions tailor-made for unit testing; the `/api/triage` retry+fallback path is exactly the kind of logic that breaks silently under model drift. The `_resetRateLimit` export in `rate-limit.ts:80` and the unused `_name` params in `pii-scrub.ts:135,158` suggest the harness was considered but never landed.

4. **Audit-trail consistency gap (non-transactional triple-write)** — In `api/triage/route.ts:101-147`, the TriageRecord insert, the FollowUp create, and the AuditLog write are three separate Prisma calls with no `db.$transaction`. Audit failures are swallowed (`.catch(log)`), so an audit row can silently miss while the triage row succeeds. The comment at `lib/triage-store.ts:538` calls the audit table "the system of record for safety events" — silent drift is a real compliance gap.

5. **Unauthenticated operational endpoints + non-idempotent `/api/seed`** — `POST /api/seed`, `POST /api/demo-chv`, `GET /api/audit`, `GET /api/supervisor/roster` are all completely unauthenticated (documented TODOs, but a judge will press). Worse, `/api/seed` is only idempotent at the demo-CHV level — every call appends 9 more triage records with no transcript-hash check. A replay (manual re-seed click, or a Cron) silently duplicates data and skews the dashboard aggregates.

---

## What a judge would ask in Q&A — 5 tough engineering questions

1. **"Your `next.config.ts` has `typescript.ignoreBuildErrors: true` and your eslint config disables `no-explicit-any`, `no-unused-vars`, `no-non-null-assertion`, `react-hooks/exhaustive-deps`, and `no-console`. Walk me through what type errors are currently being silently shipped. What's the plan to flip `ignoreBuildErrors` back to `false` before this goes to production, and what's the rollout order for re-enabling the disabled lint rules?"**

2. **"The `DashboardStats`, `AuditEntry`, and `FollowUpDTO` types are each declared twice — once in `src/lib/triage-store.ts` and once in `src/components/msaada/dashboard-helpers.ts` (and `FollowUpDTO` a third time in `PendingFollowUps.tsx`, where it widens `classification: string`, losing the `Classification` union). What guarantees me the server and client contracts won't drift? How would you restructure the types to enforce a single source of truth, and what's the migration plan for the `FollowUpDTO` drift that already exists?"**

3. **"In `api/triage/route.ts:101-147`, the TriageRecord insert, the FollowUp create, and the AuditLog write are three separate Prisma calls with no `$transaction`. If the audit write fails — which you swallow with `.catch(log)` — the triage succeeds but the audit trail silently drifts. Your own comments call the audit table 'the system of record for safety events.' How do you reconcile 'system of record' with a silent-miss window? What's the production hardening path — `db.$transaction` with the audit as a sibling write, a separate async audit queue with retries, or something else?"**

4. **"POST `/api/seed` is unauthenticated and not transcript-idempotent — every call appends 9 more triage records with no transcript-hash or seedRunId check. The dashboard's `autoSeedTriedRef` guard prevents re-seeding on empty data, but a manual re-seed click silently duplicates data and skews the aggregates you show judges. What's the minimum hardening — idempotency key, admin RBAC, replay protection — before this could be exposed in a real Kenyan county pilot?"**

5. **"The Qwen retry path (`qwen.ts:153-174`) does two attempts before falling back to `needs_followup`. The spec says 'under-triage is the higher-risk error.' What's your evidence that the fallback is rare enough to be acceptable? You have no tests, no metrics on `fallbackUsed` rates, no alerting when it fires. How would you instrument this — what would you log, what would you alert on, and at what threshold does the model get pulled?"**

---

## Specific fixes needed before presentation

| # | Priority | File:Line | Fix |
|---|---|---|---|
| 1 | **P0** | `next.config.ts:7` | Remove `typescript.ignoreBuildErrors: true`. Run `bun run build` and fix any TS errors that surface. |
| 2 | **P0** | `tsconfig.json:14` | Remove `"noImplicitAny": false` (default-true under `strict: true`). |
| 3 | **P0** | `eslint.config.mjs:12-44` | Re-enable at minimum `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-unused-vars`, `@typescript-eslint/no-non-null-assertion`, `react-hooks/exhaustive-deps`, `no-console` (warn). Fix what they surface. |
| 4 | **P1** | `src/lib/types.ts` (extend) | Consolidate the duplicated DTOs (`DashboardStats`, `AuditEntry`, `FollowUpDTO`, `FollowUpStats`, `ChvStats`, `SupervisorChvRow`, `SupervisorRoster`, `DashboardScope`, `DashboardPayload`) into `src/lib/types.ts`. Delete the duplicates in `dashboard-helpers.ts`, `PendingFollowUps.tsx`, `MyImpactCard.tsx`, `report/mine/page.tsx`. Import `@/lib/types` on the client side too. |
| 5 | **P1** | `api/triage/route.ts:160-168` | Scrub `detail: err.message` from the 500 response — return a generic `TRIAGE_FAILED` client-side; log full `err.message` server-side only. Same pattern in any other route returning `detail`. |
| 6 | **P1** | `api/triage/route.ts:101-147` | Wrap the triage+followup+audit triple in `db.$transaction` OR — if the audit must remain non-fatal — emit a structured monitoring signal (e.g., Sentry breadcrumb, a `_audit_failures` counter in a separate table) so silent misses are detectable. |
| 7 | **P2** | `app/dashboard/page.tsx` (859 lines) | Split into `dashboard/DashboardHeader.tsx`, `dashboard/DashboardView.tsx`, `dashboard/ChartCard.tsx`, `dashboard/DashboardFooter.tsx`, `dashboard/SeedPromptBanner.tsx`. Keep `page.tsx` as the orchestrator only. |
| 8 | **P2** | `lib/triage-store.ts:37` | Collapse `chpNextAction: isCrisis ? null : (isCrisis ? null : output.chp_next_action)` to `chpNextAction: isCrisis ? null : output.chp_next_action`. The inner ternary is unreachable; the redundancy reads as a bug. |
| 9 | **P2** | `db.ts:10` | Gate `log: ['query']` behind `process.env.NODE_ENV !== 'production'`. Avoids query-log noise in prod. |
| 10 | **P2** | `app/api/route.ts` | Replace the leftover "Hello, world" with a real `/api/health` returning build SHA + DB ping, or delete the file. |
| 11 | **P2** | `lib/auth.ts:77-81` | Remove the dead `requireChv()` export (no caller) OR migrate routes to use it (cleaner: replace inline `if (!chv) return 401` with `try { chv = await requireChv() } catch { return 401 }`). |
| 12 | **P2** | `api/seed/route.ts` | Make `/api/seed` transcript-idempotent (track a transcript hash, skip already-seeded) OR gate behind an admin role and document it as destructive. |
| 13 | **P3** | `package.json` + new `src/lib/__tests__/` | Add `vitest` as devDependency. Add unit tests for `parseModelOutput` + `coerceNormal`/`coerceCrisis` (~10 cases), `scrubPII` (~12 cases), `checkRateLimit` (~6 cases). Even 30 cases establishes the harness. |
| 14 | **P3** | `.env.example` (new) | Document `DATABASE_URL=file:./db/custom.db` so a fresh clone knows the only env var. |
| 15 | **P3** | Unify palette code | Move `TONE_CLASSES` (`kpi-card.tsx:18-47`), `TONE_STYLES` (`MyImpactCard.tsx:211-216`), `CLASS_BADGE_CLASSES`/`CLASS_RING_CLASSES` (`TriageResultCard.tsx:23-33`), `CLASS_TONE` (`report/mine/page.tsx:53-58`) onto the canonical `TONE` from `dashboard-helpers.ts`. |

---

## Summary line

Msaada's engineering story is a clear win on the architecture and resilience axes (clean lib/routes/components split, RLS-equivalent data-access layer, layered Qwen retry+fallback, non-fatal audit/followup writes, de-identified logging) and a yellow card on type-safety tooling and testing (`ignoreBuildErrors: true`, eslint disables, no test runner, duplicated DTOs). The two P0 fixes (flip the build flag, restore strict lint) are an afternoon of work and would push the score to 8.0+.
