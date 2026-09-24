# Msaada Codebase Audit — `audit-1`

**Scope:** comprehensive read-only audit of every source file under `src/` and `prisma/` for the Msaada MVP (Next.js 16 + Prisma/SQLite + Qwen CHV triage).

**Methodology:** read `worklog.md` (10 review rounds), then read every source file under `src/app/`, `src/components/msaada/`, `src/lib/`, `src/hooks/`, and `prisma/schema.prisma`. Cross-referenced imports and call sites.

**Severity buckets:** `critical` (security/privacy breach or crash on common path) · `high` (broken user-facing functionality / RBAC leak) · `medium` (logic bug, edge-case crash, regression risk) · `low` (cosmetic, type-safety nit, perf, dead code).

**Tally:** 3 critical · 7 high · 13 medium · 18 low.

---

## 1. Bugs

### CRITICAL

#### C1 — Dashboard toasts are silently dropped (two toast systems wired in parallel)
- **File:line:** `src/app/layout.tsx:4,33` + `src/app/dashboard/page.tsx:92` + `src/hooks/use-toast.ts`
- **Severity:** critical
- **Description:** `RootLayout` mounts the **Sonner** `<Toaster />` from `@/components/ui/sonner`. But the dashboard page imports `useToast` from `@/hooks/use-toast` (the Radix shadcn toast system) and calls `toast({ title, description, variant })` in four places: `loadStats` error path (line 154), `seedDemo` success path (line 179), `seedDemo` error path (line 190), `handleExportCsv` success path (line 296). The Radix `Toaster` (defined in `src/components/ui/toaster.tsx`) is **never imported or mounted anywhere** — only Sonner's is. As a result every dashboard toast is dispatched into a global in-memory state that no component reads, and the user sees nothing. The dashboard's error toast ("Couldn't load dashboard"), seed-success toast, and CSV-exported toast are all invisible. Every other page (CHV submission, AuthCard, PendingFollowUps, MyImpactCard, MyRecentObservations) correctly uses Sonner's `toast.success/error/info`.
- **Suggested fix:** either (a) replace `useToast()` in `dashboard/page.tsx` with `import { toast } from "sonner"` and migrate the 4 call sites to the Sonner API (`toast.error(title, { description })`, `toast.success(title, { description })`); or (b) also mount the Radix `<Toaster />` from `@/components/ui/toaster` in `RootLayout`. Option (a) is the right call — one toast system across the app.

#### C2 — `getRecentAudit` is NOT county-filtered on the RBAC `scope=mine` path
- **File:line:** `src/app/api/dashboard/route.ts:61`
- **Severity:** critical (RBAC / privacy leak)
- **Description:** the dashboard route implements county-scoped RBAC by calling `getDashboardStatsForCounty(chv.county, days)` for `?scope=mine`. `followUpStats` is correctly county-scoped (`getFollowUpStats({ county: scopeCounty, days })`). But `getRecentAudit(8)` is called with **no county filter** — it always returns the 8 most-recent audit entries across ALL counties. A Kilifi county official using `?scope=mine` therefore sees audit-trail activity from Nairobi, Turkana, and Mombasa in the AuditStrip. `getRecentAudit` (in `src/lib/triage-store.ts:584`) doesn't even accept a county parameter — the data-access layer cannot filter at all.
- **Suggested fix:** extend `getRecentAudit` to accept `opts?: { county?: string; limit?: number }`; in the route pass `county: scopeCounty ?? undefined`; verify the AuditStrip on a county-scoped view only renders that county's entries.

#### C3 — `getMyRecords` loses `fallbackUsed` on retrieval (always returns `false`)
- **File:line:** `src/lib/triage-store.ts:107`
- **Severity:** critical (data-contract violation + misleads CHV + judge)
- **Description:** `insertTriageRecord` persists the triage record but the schema has no `fallbackUsed` column. On retrieval, `getMyRecords(chv.id, limit)` does `rows.map((r) => toDTO(r, false))` — passing a hardcoded `false`. So every record the CHV sees in `MyRecentObservations` and the printable `/report/mine` claims `fallbackUsed=false`, even when the original triage actually used the spec fallback (Qwen parse failure → `needs_followup` + confidence_note "model output could not be parsed"). `TriageResultCard` only shows the amber "Caution fallback applied" banner when `record.fallbackUsed === true` (line 80) — so the CHV never sees the caution flag on revisited records. The DTO contract (`src/lib/types.ts:61`) declares `fallbackUsed: boolean` as if it were authoritative.
- **Suggested fix:** add a `fallbackUsed Boolean @default(false)` column to the `TriageRecord` Prisma model; populate it in `insertTriageRecord`; read it back in `toDTO`; run `db:push`. (Documented as production follow-up but it's a real correctness bug for the demo since the caution banner silently never shows on history.)

### HIGH

#### H1 — No rate-limit / auth on `/api/auth/login` (brute-force vulnerability)
- **File:line:** `src/app/api/auth/login/route.ts:13-54`; rate-limit only wired in `src/app/api/triage/route.ts:46`
- **Severity:** high
- **Description:** `/api/triage` is the only route guarded by `checkRateLimit()`. `/api/auth/login` returns 401 on any miss (good — no enumeration) but has no rate limit, so an attacker can hammer it indefinitely. Combined with the demo creds being publicly documented (`demo@msaada.health` / `msaada123`) and the weak `password.length >= 6` signup rule, this is a real brute-force surface.
- **Suggested fix:** call `checkRateLimit(\`login:${emailLower}\`)` (and a global IP bucket) before the DB lookup; return 429 + Retry-After on overflow. Apply the same to `/api/auth/signup` to prevent account-creation floods.

#### H2 — No auth gate on `/api/audit` (compliance audit trail publicly readable)
- **File:line:** `src/app/api/audit/route.ts:22-39`
- **Severity:** high
- **Description:** the route has a documented `TODO (production): require a compliance-officer role`, but for the demo it's wide open — anyone (unauthenticated) can page through the entire audit log including crisis-override entries with truncated CHV labels, counties, wards, and verdicts. Even though observation text is never stored, this is a compliance trail of safety incidents that should require authentication at minimum.
- **Suggested fix:** require `getSessionChv()` → 401 if absent (minimum bar for demo); add a role check (`chv.role === "compliance_officer"`) once a role column exists. Same for `/api/supervisor/roster`.

#### H3 — No auth gate on `/api/supervisor/roster` (per-CHV aggregates exposed)
- **File:line:** `src/app/api/supervisor/roster/route.ts:20-33`
- **Severity:** high
- **Description:** same pattern as H2. Any unauthenticated caller gets the full per-CHV roster (truncated labels, county/ward, total + per-classification counts + last-7d activity + last submission timestamp). The de-identification (truncated labels) reduces but does not eliminate the privacy impact — a small county with one CHV is re-identifiable.
- **Suggested fix:** require authenticated session + supervisor role check (TODO documented).

#### H4 — `/api/seed` is unauthenticated + unbounded (DoS / cost vector)
- **File:line:** `src/app/api/seed/route.ts:141-195`
- **Severity:** high
- **Description:** POST `/api/seed` has no auth gate and no rate-limit. Each invocation runs 9 transcripts through `classifyObservation()` (Qwen chat completion) — that's 9 × ~12-15s of LLM time per call. An attacker can trivially generate hundreds of seeded records and rack up Qwen API spend. Idempotency on the demo CHV only prevents user-row duplication, not TriageRecord duplication — every call appends 9 fresh rows. Also: this endpoint can be hit by anyone, including judges accidentally double-clicking the "Seed demo data" button.
- **Suggested fix:** require an admin role OR a one-time-only flag stored in a config table; rate-limit per IP; at minimum check `triageRecord.count() > N` and refuse to seed again.

#### H5 — `/api/auth/me` returns the user's email to the dashboard page (info-leak across surfaces)
- **File:line:** `src/app/api/auth/me/route.ts:17-28`; consumer `src/app/dashboard/page.tsx:208`
- **Severity:** high (consistency / privacy-by-design)
- **Description:** the entire app is otherwise disciplined about de-identifying CHV references — audit logs use `chv·xxxx`, supervisor roster uses `chv·xxxx`, settings page renders `Account ID: chv·xxxx`. But `/api/auth/me` returns the full email, and the dashboard page reads it via `fetch("/api/auth/me")` (line 207) — typed as `{ chv: { county: string } | null }`, but the actual response body includes the email. Browser devtools / any client-side fetch can see it. The dashboard itself only uses `county`, so the email is sent pointlessly. The mismatch between "we de-identify everywhere" and "/api/auth/me leaks email" is a design inconsistency.
- **Suggested fix:** either (a) split `/api/auth/me` into a "minimal" variant used by the dashboard (`{ chv: { county } | null }` only) — keep the full version for `/settings` where the email is genuinely needed; or (b) accept the inconsistency but document it explicitly (the CHV is the authenticated user; they know their own email).

#### H6 — `POST /api/triage` returns raw error `detail` to the client
- **File:line:** `src/app/api/triage/route.ts:160-167`
- **Severity:** high (info leak)
- **Description:** the catch-all returns `{ error: "TRIAGE_FAILED", detail }` where `detail = err instanceof Error ? err.message : String(err)`. If Prisma throws ("Foreign key constraint failed on the foreign key: TriageRecord.submittedById"), or Qwen throws ("Cannot read properties of undefined (reading 'chat')"), the message is shipped to the client. The comment says "Never include observation_text in the detail" — but Prisma/SDK errors can still leak schema names, file paths, or stack snippets.
- **Suggested fix:** log the full error server-side (`console.error`), but return only a generic message like `"Internal error — please retry"` to the client. If a `detail` is needed for debugging, gate it behind `process.env.NODE_ENV !== "production"`.

#### H7 — `getRecentAudit(8)` is called on every `/api/dashboard` GET, including county-scoped requests (see C2)
- **File:line:** `src/app/api/dashboard/route.ts:61`
- **Severity:** high (duplicate of C2 from the audit-leak angle; listed separately because the fix is one-line)
- **Description:** see C2 above. Listed again because the in-place fix is trivial (pass county) whereas C3's fix is a schema migration.
- **Suggested fix:** same as C2.

### MEDIUM

#### M1 — `PendingFollowUps` shares one `note` state across all expanded follow-ups
- **File:line:** `src/components/msaada/PendingFollowUps.tsx:85, 119, 326-330
- **Severity:** medium
- **Description:** a single `useState("")` for the resolution note. If the CHV expands follow-up A, types "revisited mother, sleep improving", then collapses A and expands B, B's textarea shows A's note (because `value={note}` reads the same state). If they submit B, B inherits A's note. The note is supposed to be per-follow-up and de-identified; cross-contamination could attach a note to the wrong household — a clinical-record integrity bug.
- **Suggested fix:** store notes in a `Record<string, string>` keyed by follow-up id: `const [notes, setNotes] = useState<Record<string, string>>({})`, value=`{notes[f.id] ?? ""}`, onChange=`setNotes(n => ({...n, [f.id]: e.target.value}))`, submit `notes[f.id]`. Reset on successful resolve.

#### M2 — `?status=foo` query param on `/api/followups` is `as`-cast to `FollowUpStatus | "all"` without validation
- **File:line:** `src/app/api/followups/route.ts:22, 30`
- **Severity:** medium
- **Description:** `url.searchParams.get("status") as FollowUpStatus | "all" | null` is a bare cast. If a client passes `?status=foo`, the cast pretends it's a valid `FollowUpStatus`, then `getMyFollowUps(chv.id, { status: "foo" as ... })` adds `status: "foo"` to the Prisma `where` clause (triage-store.ts:217). Prisma's `where.status` is a string column with no enum constraint, so this either returns 0 rows silently or — depending on Prisma's behavior — throws. Either way the API contract is broken.
- **Suggested fix:** validate against a Set `["pending","done","missed","all"]` and return 400 `INVALID_STATUS` otherwise.

#### M3 — `getAuditPage` accepts `page` / `pageSize` without NaN-guarding
- **File:line:** `src/app/api/audit/route.ts:31-32` → `src/lib/triage-store.ts:625-626`
- **Severity:** medium
- **Description:** route does `page: page ? Number.parseInt(page, 10) : 1` — if `?page=abc` then `Number.parseInt("abc", 10)` returns `NaN`. `getAuditPage` then runs `Math.max(1, NaN) = NaN` and `skip: (NaN - 1) * pageSize = NaN`. Prisma will likely throw `PrismaClientValidationError` → 500. Same for `pageSize`. Same pattern in `/api/dashboard?days=abc` (route line 41 guards with `!Number.isNaN` — good, but audit doesn't).
- **Suggested fix:** in the audit route, check `Number.isNaN(parsed)` and fall back to the default; also clamp pageSize to a max.

#### M4 — Dashboard mounts an unkeyed auto-seed `useEffect` that re-fires on every `days`/`scopeMode` change
- **File:line:** `src/app/dashboard/page.tsx:225-238`
- **Severity:** medium
- **Description:** the auto-seed effect's deps are `[loadStats, seedDemo]`, but both are `useCallback`s whose deps include `[days, scopeMode, toast]` (loadStats) and `[loadStats, toast]` (seedDemo). So whenever `days` or `scopeMode` changes, both callback identities change → this effect re-fires → `loadStats({silent: true})` runs again on top of the explicit `[days, scopeMode, loadStats]` effect at line 247-249. The race is guarded by `reqIdRef`, so the latest fetch wins, but you get a duplicate fetch on every filter switch and the auto-seed-then-bail branch (`autoSeedTriedRef.current === true`) runs unnecessarily. Worse: if a future refactor resets the ref, you'd auto-seed twice.
- **Suggested fix:** extract the auto-seed into its own effect keyed on `[]` (mount-only) using a stable ref for the latest `loadStats` / `seedDemo`, or use `useEffectEvent` (React 19) for the callbacks.

#### M5 — Dashboard hardcodes "Last 14 days" / "last 14 days" / "across all counties" in subtitles even when the user has selected 7d/30d or scope=mine
- **File:line:** `src/app/dashboard/page.tsx:621` (KPI hint), `:702` (CountyBarChart subtitle), `:707-708` (DailyTrendChart subtitle), `src/components/msaada/dashboard-helpers.ts:218` (insight body "across the network")
- **Severity:** medium (factual UI inconsistency judges will spot)
- **Description:** the KPI "Total observations" hint is the string literal `"Last 14 days"` regardless of the actual `days` state. The chart subtitles say "last 14 days" / "across all counties" even when the user picked 7d/30d or is scoped to one county. The dashboard's own header says "Last {days} days" correctly — only the static subtitles are stale.
- **Suggested fix:** compute `hint={`Last ${days} days`}`; pass `days` into the chart subtitles; gate the "across all counties" wording on `scope.mode === "all"`.

#### M6 — `createFollowUp` and `writeAuditEntry` failures are swallowed via `.catch()` on the triage path
- **File:line:** `src/app/api/triage/route.ts:119-124, 130-147`
- **Severity:** medium
- **Description:** both side-effect calls use the `await promise.catch(log)` pattern. This is intentional ("audit write failure must not fail the triage response"), but it has a subtle cost: a Prisma connection-pool exhaustion or a transient SQLite write lock failure would be silently logged once per request and never surfaced. The CHV sees a successful triage response; the audit trail and follow-up silently don't get created. For the audit trail in particular, a missing entry means the "system of record for safety incidents" is incomplete — the very invariant the audit layer is supposed to guarantee.
- **Suggested fix:** add a counter (`auditWriteFailures`) and a periodic `/api/health` check that surfaces it; or return a `warning` field in the triage response when audit-write fails so the client can flag it. At minimum, log with structured severity `error` (currently `console.error`, which is fine) and add an alert.

#### M7 — `getDashboardStats(days)` and `getAggregateByCounty(days)` interpret `days` inconsistently
- **File:line:** `src/lib/triage-store.ts:364, 410, 491`
- **Severity:** medium (latent)
- **Description:** `getAggregateByCounty(days?)` uses `days && days > 0` (so `undefined` AND `0` AND negative all mean "all time"). `getAggregateByDay(days = 14)` defaults to 14 if undefined; for `0` or negative, `for (let i = 0; i < days; i++)` doesn't execute → empty `byDay` array. `getDashboardStats(days = 14)` line 500 uses `days > 0` for the totalsGroups filter (so `0` → no filter, but `getAggregateByDay(0)` returns empty). The route layer at `/api/dashboard` clamps `days = Math.min(parsed, 90)` and `parsed > 0` (line 41), so the bad cases never reach the data layer in production — but any future caller of `getDashboardStats(0)` or `getDashboardStats(-1)` gets a mixed all-time + empty-byDay result that looks valid.
- **Suggested fix:** normalize at the top of `getDashboardStats`: `const safeDays = (!days || days <= 0) ? 14 : Math.min(days, 90);` and pass `safeDays` to all four sub-queries. Add a JSDoc invariant.

#### M8 — `CrisisPanel` has no focus trap (a11y + safety)
- **File:line:** `src/components/msaada/CrisisPanel.tsx:60-72`
- **Severity:** medium (a11y on a critical-safety modal)
- **Description:** the panel sets `role="alertdialog"`, `aria-modal="true"`, blocks Escape, and stops mouse-down propagation. But it does NOT trap keyboard focus — a user pressing Tab can move focus to inputs/buttons beneath the overlay. A screen-reader user navigating by focus could leave the dialog and interact with the submission form underneath. For a crisis-safety modal this is a real a11y gap.
- **Suggested fix:** on mount, store `document.activeElement`, focus the confirm button, install a `keydown` Tab handler that loops focus within the panel; on unmount, restore the previous focus. (Or pull in `react-focus-lock`.)

#### M9 — PII scrubber misses Nairobi landline-format phones (10+ digits) and the trailing digit of 11-digit mobiles
- **File:line:** `src/lib/pii-scrub.ts:41`
- **Severity:** medium (defense-in-depth gap)
- **Description:** `PHONE_RE = /(?:\+?254|0)[\s-]?([17])\d{2}[\s-]?\d{3}[\s-]?\d{3}/g` requires the 2nd digit to be `1` or `7` (mobile prefix). Nairobi landlines like `0201234567` (10 digits, `02` prefix) are not matched — they fall through to `ID_RE` which only catches 7-9 digit runs, so 10-digit landlines pass through unscrubbed. Also a valid 11-digit Safaricom number `07123456789` matches the first 10 chars `0712345678` and leaves the trailing `9` (and `89` for `+25471234567890`). The ID regex won't catch the leftover 1-2 digits. So a full long-form phone can leak a trailing fragment to Qwen.
- **Suggested fix:** extend `PHONE_RE` to allow `[17]` OR `2` (landlines) and loosen the digit-run tail; or add a second pass for unmatched 10-11 digit runs that start with `0` / `254`.

#### M10 — `CrisisPanel` Escape-blocker captures all Escape presses globally, including browser/DevTools shortcuts
- **File:line:** `src/components/msaada/CrisisPanel.tsx:44-53`
- **Severity:** low (intentional, but worth noting)
- **Description:** `window.addEventListener("keydown", block, true)` blocks Escape in the capture phase for the entire window. This is by design (non-dismissable), but it also blocks legitimate uses of Escape (closing a Sonner toast, exiting a Radix dropdown, browser fullscreen-exit). Acceptable for a crisis modal, but document the side effect.
- **Suggested fix:** none needed — but add a code comment noting the side effect so future maintainers don't get surprised.

#### M11 — `/api/followups/[id]` PATCH route doesn't validate that `resolutionNote` is a string
- **File:line:** `src/app/api/followups/[id]/route.ts:33-36`
- **Severity:** medium (latent type-coercion)
- **Description:** `(body ?? {}) as { status?: string; resolutionNote?: string }` is a bare cast. If a client sends `{ "status": "done", "resolutionNote": 123 }`, the cast says it's a string, and `resolveFollowUp({ resolutionNote: 123 as string, ... })` would attempt to `resolutionNote?.trim()` (triage-store.ts:245) — `(123).trim` is `undefined`, so `123?.trim()` is `undefined`, and `undefined || null` → `null`. Actually mostly safe but weird. A `null` would crash on `.trim()`.
- **Suggested fix:** explicitly check `typeof resolutionNote === "string"` before passing it down; reject `null` / non-string with 400.

#### M12 — `MyRecentObservations` and `AuditStrip` compute `relativeTime(iso)` once at render and never refresh
- **File:line:** `src/components/msaada/MyRecentObservations.tsx:53-65,234`; `src/components/msaada/AuditStrip.tsx:46-55,135`
- **Severity:** low (UX nit)
- **Description:** both components call `relativeTime(r.createdAt)` directly during render — there's no `setInterval` to re-tick the relative string. A record that was "5m ago" on first paint stays "5m ago" forever (until the user hits refresh). The dashboard's `FreshnessBadge` does tick every 30s (line 808) — copy that pattern.
- **Suggested fix:** add a 30s `setInterval` in both components (or hoist a `useNow()` hook) to re-render.

#### M13 — Dashboard RBAC bypass: any logged-in CHV can `?scope=all` and see every county
- **File:line:** `src/app/api/dashboard/route.ts:50-59`
- **Severity:** medium (RBAC design weakness, documented)
- **Description:** the route checks `scopeParam === "mine" && chv && chv.county` for the county-scoped path. But if a logged-in CHV passes `?scope=all` (or omits `scope`), they get the all-county view. The intent is that "all" is reserved for a national/admin role (per the route's TODO comment), but the demo defaults to `all` and any logged-in CHV can flip the toggle to "All" in the UI (dashboard/page.tsx:439-451). Severity is medium because (a) it's a documented demo trade-off, and (b) the data exposed is aggregate-only, not individual records. But for a real county-official RBAC story this is incomplete.
- **Suggested fix:** gate `?scope=all` behind a role check; if no role, return 403 OR silently fall back to `?scope=mine`.

### LOW

#### L1 — `insertTriageRecord` has a redundant nested ternary: `chpNextAction: isCrisis ? null : (isCrisis ? null : output.chp_next_action)`
- **File:line:** `src/lib/triage-store.ts:37`
- **Severity:** low (dead branch)
- **Description:** the inner `isCrisis ? null : output.chp_next_action` is reachable only when the outer `isCrisis` is `false`, so the inner check is always `false` and the value is always `output.chp_next_action`. Works but is confusing.
- **Suggested fix:** simplify to `chpNextAction: isCrisis ? null : output.chp_next_action`.

#### L2 — `chv.ward` is typed as `string` in `Chv` (AuthCard) but the Prisma schema allows `null`
- **File:line:** `src/components/msaada/AuthCard.tsx:22-28`; `prisma/schema.prisma:25` (`ward String?`)
- **Severity:** low (type-safety gap)
- **Description:** the `Chv` interface declares `ward: string` but Prisma's `ChvUser.ward` is `String?` (nullable). The signup route defaults `ward` to `null` if not provided (line 49-55), so a CHV without a ward would have `chv.ward === null` at runtime — the type says string. Consumers like `SubmissionForm.tsx:74` (`useState<string>(chv.ward ?? "")`) defensively coalesce, so it works, but the type lies.
- **Suggested fix:** change `Chv.ward` to `ward: string | null` and audit call sites.

#### L3 — `coerceNormal` in qwen.ts casts `JSON.parse(candidate)` to `Record<string, unknown>` without validating it's an object
- **File:line:** `src/lib/qwen.ts:100-105`
- **Severity:** low
- **Description:** if Qwen returns `"[]"` or `""123""`, `JSON.parse` succeeds and returns an array/string/number; the `as Record<string, unknown>` cast pretends it's an object; subsequent `obj.escalation` access returns `undefined` (for arrays) or throws (for primitives). For an array `[]`, `obj.escalation` is `undefined` → falls through to `coerceNormal` → `isClassification(undefined)` is false → returns `null` → caller retries. OK in practice but the cast is unsafe.
- **Suggested fix:** `if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;` after `JSON.parse`.

#### L4 — `FollowUpKpiCard` exports a dead `_missedIcon` constant
- **File:line:** `src/components/msaada/FollowUpKpiCard.tsx:130`
- **Severity:** low (dead code)
- **Description:** `export const _missedIcon = X;` is exported but never imported anywhere. The comment claims it's "for tree-shaking consistency" but exporting a value doesn't help tree-shaking — bundlers tree-shake based on actual usage, and `X` is unused in this file.
- **Suggested fix:** remove the export and remove `X` from the import list (line 4).

#### L5 — `AppNav` matches `/report/mineXYZ` as active when on `/report/mineXYZ`
- **File:line:** `src/components/msaada/AppNav.tsx:64-66`
- **Severity:** low
- **Description:** `pathname.startsWith(item.href)` means a path like `/report/mineXYZ` would match the `/report/mine` nav item as "active". Unlikely in practice (no such route), but technically imprecise.
- **Suggested fix:** `pathname === item.href || pathname.startsWith(item.href + "/")`.

#### L6 — `AppNav` has a `item.href !== "/"` guard that's dead code (`/` is not in `NAV_ITEMS`)
- **File:line:** `src/components/msaada/AppNav.tsx:66`
- **Severity:** low (dead code)
- **Description:** the guard exists to prevent `/` from prefix-matching every route — but `/` is intentionally not in `NAV_ITEMS`, so the check is defensive against a future addition. Harmless but currently dead.
- **Suggested fix:** leave as-is (it's a guard) or remove for clarity.

#### L7 — `/api/triage`'s 500 response ships `detail` to the client (already filed as H6; listed separately because the fix differs)
- **File:line:** `src/app/api/triage/route.ts:160-167`
- **Severity:** low (duplicate-tracking — see H6 for the high-severity framing)

#### L8 — `qwen.ts` logs `console.error("[qwen] attempt", attempts, "error:", err)` with the full SDK error
- **File:line:** `src/lib/qwen.ts:172`
- **Severity:** low
- **Description:** the SDK error object could (in principle) echo the user's request payload. In practice `z-ai-web-dev-sdk` errors look like HTTP status + message, but if the SDK ever echoes the prompt on validation failure, the user's observation text would land in the server log — defeating the never-persist invariant at the log layer.
- **Suggested fix:** log only `err.message` and `err.name`, not the full `err` object.

#### L9 — `SubmissionForm`'s `voiceTranscript` UI is labeled "stubbed for the demo" but is wired — misleading copy
- **File:line:** `src/components/msaada/SubmissionForm.tsx:412-416`
- **Severity:** low (UX copy)
- **Description:** the helper text says "Voice-to-text is stubbed for the demo; paste a transcript here if you recorded a voice note." But the field IS used — its content is prepended to the observation text sent to Qwen. Calling it "stubbed" is misleading.
- **Suggested fix:** rephrase to "Optional: paste a voice-note transcript here. Its content will be prepended to your observation when classifying."

#### L10 — `Samples.ts` and the seed transcripts hardcode `Household A..I` and Swahili/Sheng text — fine for demo but not parameterized
- **File:line:** `src/components/msaada/samples.ts`, `src/app/api/seed/route.ts:48-110`
- **Severity:** low (demo-only)
- **Description:** no parameterization. Fine for the hackathon MVP. Flagging only because a future i18n or per-county sample-set refactor would touch both files.
- **Suggested fix:** none — demo scope is intentional.

#### L11 — `getSupervisorRoster` calls `db.triageRecord.findMany({ distinct: ["submittedById"] })` to get "last submission per CHV"
- **File:line:** `src/lib/triage-store.ts:824-829`
- **Severity:** low (perf, N=1 per page load — fine for demo)
- **Description:** `distinct` + `orderBy: { createdAt: "desc" }` returns one row per CHV (the latest). For Prisma+SQLite this works, but `groupBy({ by: ["submittedById"], _max: { createdAt: true } })` would be a single round-trip and avoids loading full rows. The current query also fetches the `submittedById` + `createdAt` of just the latest per CHV, then we map to `lastSubMap`. Acceptable for the demo's small dataset but won't scale.
- **Suggested fix:** none for demo; if scaling, switch to `_max`.

#### L12 — `db.$executeRaw\`UPDATE TriageRecord SET createdAt = ${target} WHERE id = ${id}\`` in `/api/seed` is raw SQL
- **File:line:** `src/app/api/seed/route.ts:138`
- **Severity:** low (parameterized — safe)
- **Description:** Prisma's tagged-template raw SQL auto-parameterizes `${target}` and `${id}`, so there's no SQL injection. But raw SQL bypasses Prisma's type checking — if a future schema rename happens (e.g. `TriageRecord` → `triage_record`), this breaks silently at runtime.
- **Suggested fix:** use `db.triageRecord.update({ where: { id }, data: { createdAt: target } })` instead — same effect, no raw SQL.

#### L13 — `db.ts` enables `log: ['query']` in ALL environments (not just dev)
- **File:line:** `src/lib/db.ts:9-11`
- **Severity:** low (perf + log noise)
- **Description:** every Prisma query is logged to stdout in production. For a Qwen-backed triage app where the dashboard fires 5+ groupBy queries per request, this floods the log. Should be dev-only.
- **Suggested fix:** `log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'error', 'warn']`.

#### L14 — `next.config.ts` sets `typescript.ignoreBuildErrors: true` and `reactStrictMode: false`
- **File:line:** `next.config.ts:7-9`
- **Severity:** low (latent type-error suppression)
- **Description:** `ignoreBuildErrors: true` means `next build` won't fail even if there are TypeScript errors anywhere in the codebase. Combined with `reactStrictMode: false` (which disables React 19's strict-mode double-invoke in dev), this hides whole classes of bugs (effect double-fire, stale-closure, type drift). Fine for the hackathon; dangerous for production.
- **Suggested fix:** flip both to `false` before production; fix any surfaced type errors.

#### L15 — `DashboardSkeleton` uses `Array.from({length: 6}).map((_, i) => <Card key={i}>...)` with index keys
- **File:line:** `src/components/msaada/dashboard-states.tsx:15-22, 25-31, 37-40`
- **Severity:** low
- **Description:** index-as-key for static skeletons is fine. Flagging only for completeness.
- **Suggested fix:** none needed.

#### L16 — `TriageResultCard` uses `key={`${ind}-${i}`}` for observed-indicator list items
- **File:line:** `src/components/msaada/TriageResultCard.tsx:110`
- **Severity:** low
- **Description:** composite index key. Fine for a non-reorderable list, but if two indicators have identical text, the second `-1` collides with the first `-1`. Use `r.id + i` or `ind` itself.
- **Suggested fix:** `key={ind}` if indicators are unique; otherwise `key={r.id + "-" + i}`.

#### L17 — `getMyRecords(chv.id, limit)` `limit` is unbounded above 50 (route clamps at 50, but data-layer doesn't)
- **File:line:** `src/lib/triage-store.ts:98-108`; `src/app/api/records/mine/route.ts:26-29`
- **Severity:** low
- **Description:** the data layer takes any `limit` (could be 100000). The route clamps to 50. A future caller of `getMyRecords` directly (not via the route) could over-fetch. The `/api/records/mine?limit=` consumer at `/report/mine/page.tsx:92` hardcodes `?limit=20`.
- **Suggested fix:** clamp at the data layer: `const safeLimit = Math.min(Math.max(1, limit), 50)`.

#### L18 — `SettingsPage` calls `window.location.reload()` and `window.location.assign("/")` instead of using `next/router`'s `router.refresh()` / `router.push()`
- **File:line:** `src/app/settings/page.tsx:66, 191
- **Severity:** low (UX perf)
- **Description:** `window.location.reload()` triggers a full page reload (re-fetches all JS, loses client state). `router.refresh()` from `next/navigation` does a soft refresh. `window.location.assign("/")` likewise triggers a hard navigation. The other pages use `<Link>` for navigation correctly.
- **Suggested fix:** `const router = useRouter(); router.refresh()` for the Refresh button; `<Link href="/">` or `router.push("/")` for sign-out.

---

## 2. Missing features / incomplete implementations

### Stubbed / documented TODOs

| Route / File | Stub | Severity | Note |
|---|---|---|---|
| `/api/dashboard` (line 27) | "Production would require an admin/national role for `?scope=all`" | medium | see M13 |
| `/api/audit` (line 19) | "TODO (production): require a compliance-officer role (RBAC). Currently open for the demo" | high | see H2 |
| `/api/supervisor/roster` (line 18) | "TODO (production): require a supervisor RBAC role. Currently open for demo." | high | see H3 |
| `/api/seed` (line 36) | "TODO (production): remove or gate behind admin auth." | high | see H4 |
| `/api/demo-chv` (line 17) | "TODO (production): remove this route or gate behind a feature flag." | medium | exposed demo creds |
| `src/lib/auth.ts:30-36` | "Simple signed-ish token for demo. NOT cryptographically secure — Supabase would issue a JWT." | medium | session token is base64-encoded JSON `{uid, exp}` — no signature, no secret. Anyone can forge a session for any CHV id by base64-encoding `{"uid":"<cuid>","exp":<future-ts>}`. **This is more severe than the comment implies** — for a hackathon demo it's fine, but it's a one-line token-forgery auth bypass. Flagging here because the worklog frames it as "sufficient for the demo's auth.uid() = submitting user equivalent" without noting that the cookie has no integrity protection. |
| `src/lib/rate-limit.ts:11` | "In-memory — fine for a single-instance demo. Production would use Redis." | low | in-memory bucket; not shared across instances |
| `src/lib/qwen.ts:118-130` | retry path kept "only as a safety net" — no streaming, no `response_format: json` | low | latency follow-up |
| `src/lib/pii-scrub.ts` | scrubber is best-effort — see M9 for gaps; also no M-Pesa pin (4-digit) catch, no school-class-name catch | low | defense-in-depth; the never-persist invariant still holds |
| `src/components/msaada/SubmissionForm.tsx:412-416` | voice transcript UI labeled "stubbed" (see L9) | low | misleading copy |
| `src/app/settings/page.tsx` | page is "Settings" in name but has no actual editable settings — just a profile display + crisis-line reference | low | consider renaming to "Profile" |
| `src/components/msaada/AuditStrip.tsx` | no realtime push of new audit entries | low | documented follow-up |
| `src/lib/triage-store.ts` `proxyCountyWeeklyDelta` | per-county weekly delta is a proxy (regional delta × county share) — not a real per-county per-day aggregate | low | data-contract limitation; the `‡` footnote in `county-table.tsx` explains this honestly |
| Worklog round-9 follow-up | "Live-verify mark-done → 'All caught up' state transition" | low | the worklog notes the server died mid-response in round 9; the API logic was verified but the UI transition wasn't live-demoed |
| Worklog round-10 follow-up | "Supervisor roster: add a per-CHV follow-up completion column" | low | next-review follow-up |

### Spec-demanded but not built

- **Realtime push of new audit entries to `/audit`** — worklog mentions this 4 times as a remaining follow-up; the spec calls for Supabase Realtime. The sandbox has no Realtime equivalent (no WebSocket server, no SSE endpoint). The audit page is a manual-refresh client-poll.
- **Streaming triage response** — worklog mentions 5 times; `/api/triage` is still a single blocking POST that takes ~12-15s.
- **Compliance-officer RBAC role on `/audit`** — worklog mentions 4 times.
- **Supervisor RBAC role on `/supervisor`** — worklog mentions 3 times.
- **CHV weekly report email/print** — the `/report/mine` page exists (print via `window.print()`), but there's no email/subscription delivery.

### Demo-credential exposure

- `DEMO_CHV_EMAIL` and `DEMO_CHV_PASSWORD` are hardcoded constants in `src/lib/auth.ts:83-84`, re-exported by `/api/demo-chv` (which returns the password in the response body), and shown in the UI on the AuthCard (`src/components/msaada/AuthCard.tsx:35-36, 333-337`). Fine for a hackathon demo; flagged here because the worklog claims the credential is "demo" but it's also the **only seeded user** with audit-follow-up history, so a judge (or attacker) using it can see and mutate real demo state.

---

## 3. Code inconsistencies

### Dead code

- `src/components/msaada/FollowUpKpiCard.tsx:130` — `export const _missedIcon = X;` is exported and unused.
- `src/components/msaada/AppNav.tsx:66` — `item.href !== "/"` guard is unreachable (`/` not in `NAV_ITEMS`).
- `src/lib/triage-store.ts:37` — inner `isCrisis ? null : ...` is unreachable (always `false` at that point). See L1.
- `src/components/ui/toaster.tsx` — the radix `Toaster` is defined but never mounted anywhere (see C1).

### Inconsistent patterns

- **Toast system split** — `dashboard/page.tsx` uses Radix `useToast`; every other page uses Sonner `toast`. See C1.
- **Date format helpers** — every component reinvents its own `relativeTime` / `fmtRelative` / `fmtSince` / `fmtDate` / `formatTimestamp` (in `MyRecentObservations.tsx:53-65`, `AuditStrip.tsx:46-55`, `MyImpactCard.tsx:38-46`, `supervisor/page.tsx:53-61`, `report/mine/page.tsx:67-73`, `TriageResultCard.tsx:35-48`, `audit/page.tsx:73-80`). They differ in thresholds (24h vs 7d, "just now" vs "today"). Should be one shared `src/lib/format-time.ts`.
- **`CLASS_LABEL` map** — defined in `dashboard-helpers.ts:128-136`, `TriageResultCard.tsx:17-21`, `MyRecentObservations.tsx:35-39`, `report/mine/page.tsx:47-51`, `PendingFollowUps.tsx:52-56`. Five copies with slightly different key sets (some include `escalation`, some don't).
- **`toneKey` / `classIcon`** — duplicated in `audit/page.tsx:56-71`, `AuditStrip.tsx:29-44`, `MyRecentObservations.tsx:41-51`, `report/mine/page.tsx:60-65`. Same logic, four copies.
- **`ChvInfo` / `Chv` / `ChvStats` interfaces** — defined inline in `report/mine/page.tsx:27-43`, `settings/page.tsx:24-30`, `MyImpactCard.tsx:19-29`, `AuthCard.tsx:22-28`. The `Chv` from AuthCard is exported and imported by `SubmissionForm`, but the others are local redefinitions with subtly different shapes (`ward: string` vs `ward: string | null`).
- **`supervisor/page.tsx:79` swallows the error in `catch {}` without logging** — the user sees "Couldn't load the roster" but the server-side error is lost. Other pages (`audit/page.tsx:106`, `report/mine/page.tsx:106`) at least set the message into state.

### Naming

- `src/app/api/route.ts` is a leftover "Hello, world!" handler at the API root — never referenced; harmless but should be removed or replaced with a metadata endpoint.
- `src/components/msaada/county-bar-chart.tsx` exports both `CountyBarChart` and `DailyTrendChart` from the same file — the filename only mentions one. Confusing.

---

## 4. Type-safety issues

| File:line | Issue | Severity |
|---|---|---|
| `src/lib/triage-store.ts:80` | `classification: row.classification as Classification` — unsafe cast from DB string to enum without validation | medium |
| `src/lib/triage-store.ts:160` | `(["pending","done","missed"].includes(r.status) ? r.status : "pending") as FollowUpStatus` — runtime check then cast, OK but could use a Set | low |
| `src/lib/triage-store.ts:167` | `classification: (t?.classification ?? "needs_followup") as Classification` — defaults to `needs_followup` if the join missed, then casts | medium |
| `src/lib/triage-store.ts:474, 974` | `aggregateTag: g.aggregateTag as string` — `aggregateTag` is `string | null` from Prisma groupBy; the prior `.filter((g) => g.aggregateTag)` narrows it but TS doesn't propagate the narrowing through `map` | low |
| `src/lib/qwen.ts:42` | `CLASSIFICATIONS.includes(v as Classification)` — `Array.includes` requires the arg to be of the element type; `v` is `unknown`. The cast is the standard workaround, but a type predicate helper `isStringIn(v, CLASSIFICATIONS)` would be cleaner | low |
| `src/lib/qwen.ts:100` | `let obj: Record<string, unknown>; obj = JSON.parse(candidate)` — `JSON.parse` returns `any`; assigning to `Record<string, unknown>` doesn't validate. Arrays / primitives sneak through (see L3) | medium |
| `src/lib/auth.ts:42` | `JSON.parse(...) as { uid?: string; exp?: number }` — bare cast on untrusted input (the cookie). The `parseSessionToken` does check `!decoded.uid || !decoded.exp` after, so it's defensively handled — but the cast is unsafe in principle | low |
| `src/lib/db.ts:3` | `globalThis as unknown as { prisma: ... }` — standard Prisma singleton pattern; safe | low |
| `src/app/api/triage/route.ts:66` | `body as Partial<TriageRequest>` — body is `unknown`; the cast pretends it has the right shape, then the field-level `typeof` checks do the real validation. Acceptable pattern. | low |
| `src/app/api/triage/route.ts:76,79` | `county as County` after a `COUNTIES.includes(county as County)` check — the prior cast is required for `Array.includes` typing; the second cast is redundant | low |
| `src/app/api/followups/route.ts:22` | `url.searchParams.get("status") as FollowUpStatus | "all" | null` — bare cast without validation (see M2) | medium |
| `src/app/api/dashboard/route.ts:45` | `scopeParam as "mine" | "all" | null` — bare cast, but the `=== "mine"` check makes it safe | low |
| `src/components/msaada/SubmissionForm.tsx:87, 71` | `v as County` / `chv.county as County` — Select always returns one of the COUNTIES values, but the cast skips a runtime check | low |
| `src/components/msaada/SubmissionForm.tsx:143, 168` | `(await res.json()) as TriageRecordDTO | { error: string }` then `data as TriageRecordDTO` after `"error" in data` check — fine | low |
| `src/components/msaada/AuthCard.tsx:75, 118, 142` | `data.chv as Chv` after `data.error` check — fine but the cast skips a full-shape validation | low |
| `src/components/msaada/dashboard-helpers.ts` `(p.payload as { total?: number })?.total ?? 0` | `classification-donut.tsx:47` — `payload` type at line 30 is `{ color?: string } | undefined`; the cast adds `total` | low |
| `src/app/dashboard/page.tsx:208` | `(await res.json()) as { chv: { county: string } | null }` — actual response has more fields; `chv.county` could be `null` per the schema (though signup forces a county) | low |
| `src/lib/rate-limit.ts:75` | `Math.ceil((needed / refillRate) / 1000) * 1000` — fine | — |

---

## 5. Error-handling gaps

| File:line | Issue | Severity |
|---|---|---|
| `src/app/api/triage/route.ts:119-124` | `createFollowUp(...).catch(e => console.error(...))` — promise rejection from the data layer is logged but never retried; if Prisma is transiently locked, the follow-up is lost silently | medium (M6) |
| `src/app/api/triage/route.ts:130-147` | `writeAuditEntry(...).catch(...)` — same pattern; the audit trail is the system of record for safety incidents — silent loss is a real concern | medium (M6) |
| `src/app/api/triage/route.ts:160-167` | catch-all returns raw `err.message` to the client (see H6) | high (H6) |
| `src/lib/qwen.ts:170-173` | catch swallows the SDK error and retries once; if the SDK throws on both attempts, the fallback is returned. Correct, but the error object is logged in full (could include prompt — see L8) | low |
| `src/app/supervisor/page.tsx:79-81` | `catch {}` swallows the error without even logging — the user sees "Couldn't load" but the server-side error is untraceable | low |
| `src/app/dashboard/page.tsx:147-161` | `loadStats` error sets `errorMsg` and shows a toast — but the toast is invisible (see C1) | critical (C1) |
| `src/components/msaada/SubmissionForm.tsx:145-148` | 401 path calls `onLogout()` which calls `fetch("/api/auth/logout")` — if the network is down, the catch in `handleLogout` (page.tsx:80-90) ignores the failure and clears state locally. Fine. | — |
| `src/components/msaada/SubmissionForm.tsx:199-204` | network-error catch sets `inlineError` AND toasts via Sonner — correct, the user sees the error | — |
| `src/components/msaada/PendingFollowUps.tsx:122` | `await res.json().catch(() => ({}))` — defensive JSON parse on error response; good pattern | — |
| `src/components/msaada/PendingFollowUps.tsx:134-136` | `catch { toast.error("Network error...") }` — Sonner toast, correct | — |
| `src/app/api/seed/route.ts:163-172` | backdate failure is logged but the record still exists with today's `createdAt` — graceful degradation, fine | — |
| `src/app/api/followups/[id]/route.ts:27-32` | `try { body = await req.json() } catch { return 400 }` — correct | — |
| `src/lib/auth.ts:46-48` | `parseSessionToken` try/catch returns null on JSON parse failure — defensive | — |

### Unhandled promise rejection risks

- `src/app/page.tsx:80-90` `handleLogout` calls `await fetch("/api/auth/logout", { method: "POST" })` inside a try/catch — safe.
- `src/components/msaada/AuthCard.tsx:130` `await fetch("/api/demo-chv", { method: "POST" })` — result is awaited but the response is not checked; if the call fails, the subsequent login call will fail and the outer catch handles it. Safe.
- `src/app/dashboard/page.tsx:170-186` `seedDemo` — wrapped in try/catch with a finally. Safe.

---

## 6. Performance issues

### N+1 / query patterns

- **`getDashboardStats(days)`** fires 4 `Promise.all` queries (`byCounty` groupBy, `byDay` findMany, `byTag` groupBy, totalsGroups groupBy). Plus `getRecentAudit(8)` and `getFollowUpStats({ county, days })` (3 more queries). **7 DB round-trips per `/api/dashboard` GET.** SQLite is local so latency is low, but it's still 7 queries per page-load and per-refresh.
- **`getDashboardStatsForCounty`** also fires 4 queries (countyGroups, dayRows findMany, tagGroups, totalsGroups). Plus audit + followUpStats = 7 queries per `?scope=mine` request.
- **`getSupervisorRoster`** fires 4 parallel queries (groups, chvs, last7Counts, lastSubs). Reasonable.
- **`getMyStats`** fires 5 parallel queries. Reasonable.
- **`getAuditPage`** fires 2 parallel queries (rows + count). Good.
- **`getMyRecords(chv.id, limit)`** fires 1 query. Good.
- **`getMyFollowUps`** fires 1 query with a join include. Good.
- **`getFollowUpStats`** fires 3 parallel queries (statusGroups, overdueCount, total). Good.

### Missing indexes

- **`FollowUp.triageRecordId`** has no index, but is used as the join key in every `getMyFollowUps` / `createFollowUp` / `resolveFollowUp` query (via the `include: { triageRecord: ... }`). Add `@@index([triageRecordId])` for O(log n) joins.
- **`AuditLog.triageRecordId`** has no index — `getAuditPage` and `getRecentAudit` don't filter on it currently, but if a future "show audit entries for this triage record" feature lands, it'll be a table scan.
- **`TriageRecord.submittedById`** has no index — but it's a foreign key, so SQLite auto-creates an index for FK enforcement. Prisma may or may not surface this; explicit `@@index([submittedById])` is safer. Used in `getMyRecords`, `getMyStats`, `getSupervisorRoster`.
- All other indexes are present (`county, createdAt`, `classification`, `aggregateTag`, `escalation`, `chvId, status`, `dueAt`, `status`, `createdAt`, `actorId`, `county`, `event`).

### Heavy bundles

- **`/dashboard`** is the heaviest client bundle: 4 Recharts charts + KPI grid + table + audit strip + freshness badge + 6 KpiCard motion wrappers. The worklog mentions it crashed Turbopack under browser load in rounds 3-5 — fixed in round 6 by `next/dynamic` code-splitting each chart into its own chunk (`src/app/dashboard/page.tsx:49-64`). Good.
- **`framer-motion`** is used in nearly every component — even small ones like `KpiCard` (motion.div + whileHover) and `motion.li`. For static lists, this is overkill. The bundle cost is ~50KB gzipped.
- **`recharts`** is ~100KB+ and only used on the dashboard — already code-split.
- **`lucide-react`** imports — most components import by name (`import { ShieldCheck, Activity, ... } from "lucide-react"`), which is tree-shakeable. Good.
- **`@radix-ui/*`** — many UI primitives are installed (51 packages), but only a subset are used by Msaada components (`button`, `card`, `badge`, `separator`, `select`, `tabs`, `textarea`, `label`, `collapsible`, `skeleton`, `alert`, `table`, `tooltip` (only via Toaster)). The unused ones (accordion, context-menu, dialog (only via Alert), dropdown-menu, hover-card, etc.) are pulled in by shadcn's CLI but not imported anywhere — they should be tree-shaken out, but if anything is accidentally imported, the bundle grows.
- **`next-auth`, `next-intl`, `next-themes`, `react-markdown`, `react-syntax-highlighter`, `@mdxeditor/editor`, `embla-carousel-react`, `react-resizable-panels`, `cmdk`, `vaul`, `react-day-picker`, `@dnd-kit/*`, `@tanstack/react-query`, `@tanstack/react-table`, `zustand`** — all installed but unused by Msaada (they came from the scaffold). `next-themes` is used by `sonner.tsx`'s `useTheme()` call though.

### Missing lazy-load

- `recharts` is already code-split on the dashboard via `next/dynamic`.
- The `motion` import from `framer-motion` is static everywhere — could be replaced with CSS transitions for non-orchestrated animations (most of them).
- `MyRecentObservations`, `MyImpactCard`, `PendingFollowUps` are all eagerly imported on `/` (`src/app/page.tsx:7-9`). They make non-trivial fetches on mount. Could lazy-load the lower-priority ones (`MyRecentObservations` is below the fold) with `next/dynamic` to shrink the initial bundle of `/`.

### Prisma `log: ['query']` in production (see L13)

- Every query is logged to stdout. For the dashboard's 7-query-per-load pattern with auto-refresh on filter changes, this floods logs.

### Auto-seed on dashboard mount calls Qwen 9 times

- `src/app/dashboard/page.tsx:225-238` auto-calls `seedDemo({ silent: true })` if `totals.total === 0` on first mount. `seedDemo` runs `classifyObservation()` 9 times sequentially (~108-135s of LLM time). The user sees the dashboard hang on `DashboardSkeleton` for 2+ minutes the first time. The `autoSeedTriedRef` prevents repeats, but the first impression is bad.
- Suggested fix: show a progress toast ("Seeding demo data — this takes ~2 min…") OR pre-seed at deploy time.

---

## Top 5 critical/high issues (for the fix agents' priority queue)

1. **C1 — `src/app/layout.tsx:4,33` + `src/app/dashboard/page.tsx:92`** — Dashboard mounts Sonner `<Toaster>` but uses Radix `useToast()`; all dashboard toasts (load error, seed success, CSV exported) are silently invisible.
2. **C2/H7 — `src/app/api/dashboard/route.ts:61`** — `getRecentAudit(8)` is NOT county-filtered on `?scope=mine`, leaking other counties' audit activity into a county-scoped dashboard.
3. **C3 — `src/lib/triage-store.ts:107`** — `getMyRecords` returns `fallbackUsed: false` for every retrieved record (schema has no column), so the "Caution fallback applied" banner never shows on history.
4. **H1 — `src/app/api/auth/login/route.ts:13-54`** — no rate-limit on `/api/auth/login` (or `/signup`), brute-force vulnerability; only `/api/triage` is rate-limited.
5. **H6 — `src/app/api/triage/route.ts:160-167`** — catch-all returns raw `err.message` as `detail` in the 500 response, leaking Prisma/SDK internals.

---

## Appendix — files audited

- `prisma/schema.prisma`
- `src/lib/types.ts`, `qwen.ts`, `auth.ts`, `triage-store.ts`, `pii-scrub.ts`, `rate-limit.ts`, `db.ts`, `utils.ts`
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/route.ts`
- `src/app/dashboard/{page,layout}.tsx`
- `src/app/audit/page.tsx`, `src/app/supervisor/page.tsx`, `src/app/report/mine/page.tsx`, `src/app/settings/page.tsx`
- `src/app/api/{route,dashboard,seed,triage}.ts`
- `src/app/api/auth/{login,signup,logout,me}/route.ts`
- `src/app/api/demo-chv/route.ts`
- `src/app/api/audit/route.ts`
- `src/app/api/records/mine/route.ts`
- `src/app/api/stats/mine/route.ts`
- `src/app/api/supervisor/roster/route.ts`
- `src/app/api/followups/route.ts` and `src/app/api/followups/[id]/route.ts`
- `src/components/msaada/{AuthCard,SubmissionForm,CrisisPanel,TriageResultCard,MyRecentObservations,MyImpactCard,PendingFollowUps,AuditStrip,FollowUpKpiCard,AppNav,kpi-card,county-bar-chart,top-tags-chart,classification-donut,insight-callouts,county-table,dashboard-states,dashboard-helpers,samples}.tsx`
- `src/hooks/use-toast.ts`
- `src/components/ui/{sonner,toaster}.tsx`
- `next.config.ts`, `package.json`
