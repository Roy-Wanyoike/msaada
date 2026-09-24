# issues-11-13 — community-report-security-fixer

## Scope

2 P0 community-report vulnerabilities from `reviews/security-resilience-review.md`:

- **#11 / C3** — PII scrubber bypassed for `landmark`, `directions`, `reporterName`, `reporterContact` on the public `POST /api/community-reports` endpoint. Only `description` was being scrubbed; the other four free-text fields were persisted raw and surfaced verbatim on GET (list + single-fetch + ResponseCaseDTO).
- **#13 / C5** — `GET /api/community-reports` (list) and `GET /api/community-reports/[id]` (single-fetch) lacked county scoping. The store's `getReports()` accepts a `county` filter from the caller, but the caller never passed the session CHV's county — a CHV in Kilifi could read all Nairobi reports by passing `?county=Nairobi`.

Files touched (exactly the three permitted):

- `src/app/api/community-reports/route.ts` — POST (PII scrubbing) + GET (county scoping + reporterContact stripping)
- `src/app/api/community-reports/[id]/route.ts` — GET (county scoping for single-fetch)
- `src/lib/community-report-store.ts` — doc comment on `getReports()` clarifying the trust-boundary contract

## Changes

### `src/app/api/community-reports/route.ts` — Fix #11 (POST) + Fix #13 (GET list)

- Added `scrubNote` to the `@/lib/pii-scrub` import (the lighter scrubber that skips the 7-9 digit ID regex, so plot/house numbers in operational-address fields are not nuked).
- Added module-level `ADMIN_ROLES` Set = `["county_admin", "moh_admin", "system_admin"]`. Any unlisted role is treated as county-scoped by least-privilege default (mirrors the `SUPERVISOR_ROLES` pattern in `src/app/api/response-cases/route.ts:15-20`).
- **POST** — `landmark` and `directions` are now run through `scrubNote()` (after trim + length slice, before passing to `createReport()`). `reporterName` is run through the full `scrubPII().redacted` pass (it is a personal name by definition). `reporterContact` is still persisted raw — the operational follow-up use case (assigned CHV phones the reporter) is legitimate, but encryption-at-rest is P2 hardening per the security review. The leak is closed in MVP scope by stripping `reporterContact` from list responses (see below).
- **GET (list)** — after `getSessionChv()`, resolve `isAdmin` from `chv.role` and `sessionCounty = chv.county` BEFORE reading the query string. For non-admins, `countyTyped` is forced to `sessionCounty` (the query-string `county` param is IGNORED — so a CHV in Kilifi cannot ask for Nairobi data). For admins, the query-string `county` filter is respected (validated against `COUNTIES`; absent = all counties). If a non-admin session has no county set, the user simply sees no reports (least privilege). After `getReports()` returns, `reportsWithoutContact = reports.map(({ reporterContact: _stripped, ...rest }) => rest)` strips `reporterContact` from every report in the response body — the contact is only surfaced on the single-fetch endpoint to an authenticated CHV/supervisor (per the security review's resolution for `reporterContact`).

### `src/app/api/community-reports/[id]/route.ts` — Fix #13 (single-fetch)

- Added module-level `ADMIN_ROLES` Set (mirrors the list route).
- After `getReport(id.trim())` and the 404 check, added: `isAdmin = ADMIN_ROLES.has(chv.role ?? "chv")`. For non-admin roles, `if (!chv.county || report.county !== chv.county)` returns 403 `{ error: "COUNTY_MISMATCH" }`. Admins see any report.
- `reporterContact` is NOT stripped here — the instruction says it is "only visible on the single-fetch endpoint to the assigned CHV/supervisor", and the single-fetch now requires the caller to be in the same county (or an admin). The instruction does not require assignment-level ownership for the [id] endpoint (only county match) — county match is the documented RLS-equivalent promise.

### `src/lib/community-report-store.ts` — doc comment only

- `getReports()` already accepted a `county` filter. Added a doc comment explicitly stating the trust boundary: the store does NOT read the session — the route MUST pass the session CHV's county for non-admin roles and ignore any client-supplied query-string `county` for those roles. The route is the trust boundary; the store is a pure data-access layer.

## Verification

- `bun run lint` — exit 0, no errors (only a pre-existing `.eslintignore` infra warning unrelated to these changes).
- Dev server log shows Next.js 16.1.3 ready + serving `/` cleanly.

## Out-of-scope (deliberately not touched per task constraint)

- PII scrubber regex gaps (C7) — out of scope for issues #11/#13.
- Idempotency P2002 catch (C9) — out of scope.
- `/api/audit` + `/api/dashboard` unauthenticated (C6) — out of scope.
- Encryption-at-rest for `reporterContact` — P2 hardening, explicitly deferred per the security review.
