# QA — Route Verification + Mobile Audit (Issues #5 + #7)

**Agent:** qa-engineer
**Date:** 2024 (hackathon MVP)
**Scope:** Verify all 12 routes render without runtime errors; audit mobile responsiveness on `/report` and `/cases` (375 × 667 viewport); check touch targets ≥ 44 px and horizontal overflow.

## Methodology

1. Started dev server on port 3000 (Next.js 16.1.3, Turbopack) using `setsid bash -c '... exec next dev'` to keep the bg process alive for the duration of one bash call.
2. Warmed all 12 routes via `curl` (reduces browser compile pressure):
   - All 12 returned **HTTP 200** on first hit.
3. Used `agent-browser` (Playwright-backed) at desktop viewport (1280 × 800):
   - **Public routes** (`/report`, `/docs`): cookies cleared, opened directly.
   - **Authed routes** (`/`, `/cases`, `/households`, `/dashboard`, `/audit`, `/supervisor`, `/referrals`, `/report/mine`, `/settings`, `/admin`): cleared cookies, opened `/`, clicked "Use demo account" button, then navigated to each route.
4. For each route: `agent-browser snapshot -c` (render check) + `agent-browser errors` (runtime errors) + screenshot saved to `/home/z/my-project/reviews/screenshots/`.
5. Mobile audit: `agent-browser set viewport 375 667`, re-checked `/report` + `/cases`, ran JS `eval` to measure `scrollWidth > clientWidth` (overflow) and enumerated all interactive elements' bounding boxes via `getBoundingClientRect()` for the touch-target check.

## Route-by-Route Status

| # | Route | HTTP | Status | Issues Found |
|---|---|---|---|---|
| 1 | `/` | 200 | ✅ OK | None. Renders CHV home/login with `Use demo account` button; after demo login, renders "My impact" dashboard (18 obs, 4 counties, 10 pending follow-ups). No runtime errors. |
| 2 | `/report` | 200 | ✅ OK | None. Public multi-step report form ("Tell a community health volunteer what is happening." + "Start a report" button) renders. Progress list + non-dismissable crisis panel present. No runtime errors. |
| 3 | `/cases` | 200 | ✅ OK | None. CHV response-case dashboard renders — summary cards (TOTAL ASSIGNED / PENDING ACTION / ATTENDED / RESOLVED), status filter, case list with action buttons (Mark attended / Unable to reach). No runtime errors. |
| 4 | `/households` | 200 | ✅ OK | None. Identity-chain household register renders (8 households, 18 members, 18 encounters). Household list with "View household roster" toggles + "Create a new household" button. No runtime errors. |
| 5 | `/dashboard` | 200 | ✅ OK | None. County Triage Dashboard renders — KPI summary (TOTAL OBSERVATIONS=6), RBAC scope buttons (Kilifi / All), time-range (7d/14d/30d), CSV export, Refresh. Title correctly switches to "Msaada · County Triage Dashboard". No runtime errors. |
| 6 | `/audit` | 200 | ✅ OK | None. Audit log renders — 23 records, county + event filters, "Escalations only" toggle, pagination (Page 1 of 2). Footer correctly notes "TODO: RBAC for compliance-officer role" (known limitation, not a runtime error). |
| 7 | `/supervisor` | 200 | ✅ OK | None. CHV roster renders — active CHVs count, total observations, per-CHV breakdown table. Footer notes "TODO: supervisor RBAC role for production" (known limitation). |
| 8 | `/referrals` | 200 | ✅ OK | None. Referrals page renders — summary region, status filter ("All statuses"). No runtime errors. |
| 9 | `/report/mine` | 200 | ✅ OK | None. CHV weekly triage report renders — totals, "THIS WEEK" stats, escalations, classification breakdown (Routine 8, Follow-up 6, Referral 4, Escalation 2). Print button present. |
| 10 | `/settings` | 200 | ✅ OK | None. CHV settings renders — Email, County, Ward, Account ID, crisis-line quick reference (Kenya Red Cross 1199, Befrienders Kenya), CHV protocol card, Refresh + Sign out buttons. |
| 11 | `/admin` | 200 | ✅ OK (intentional RBAC gate) | Renders an RBAC gate message: "Only County Admins, Supervisors, and MoH officers can access this page. Your role: chv" + "Demo: log in as county.admin@msaada.health / msaada123". This is correct behavior — the demo account is a `chv`-role user and is correctly denied admin content. NOT a defect. |
| 12 | `/docs` | 200 | ✅ OK | None. Documentation hub renders — tabbed README/Problem/License view, primary nav bar, "Back to app" link. README content visible. No runtime errors. |

**Summary: 12 / 12 routes render without runtime errors.**

## Mobile Audit (375 × 667 — iPhone SE-class viewport)

### `/report` (mobile)
- **Render:** ✅ Renders. Same multi-step report form as desktop, no layout breakage.
- **Runtime errors:** ✅ None.
- **Horizontal overflow:** ✅ None. `scrollWidth=375, clientWidth=375, overflow=false`.
- **Touch targets (first 6 interactive elements):**

| # | Element | Text | W × H (px) | ≥ 44×44? |
|---|---|---|---|---|
| 1 | `<a>` | Skip to main content | 1 × 1 | ⚠️ Intentional (a11y skip link, visible on focus only) |
| 2 | `<a>` | Msaada (header logo) | 97 × 24 | ❌ Height 24 < 44 — but standard practice for brand logos |
| 3 | `<button>` | Start a report | 293 × 44 | ✅ |
| 4 | `<a>` | Back to home | 293 × 44 | ✅ |
| 5 | `<button>` | Continue | 293 × 44 | ✅ |
| 6 | `<a>` | CHV sign in (footer link) | 69 × 14 | ❌ Footer text link, common pattern |

**Primary action buttons all pass 44 px height.** Brand logo + footer link are below threshold — acceptable per common mobile patterns, but flagged for awareness.

### `/cases` (mobile)
- **Render:** ✅ Renders. Summary cards + status filter + case list with action buttons.
- **Runtime errors:** ✅ None.
- **Horizontal overflow:** ✅ None. `scrollWidth=375, clientWidth=375, overflow=false`.
- **Touch targets (first 20 interactive elements):**

| # | Element | Text | W × H (px) | ≥ 44×44? |
|---|---|---|---|---|
| 1 | `<a>` | Skip to main content | 1 × 1 | ⚠️ Intentional skip link |
| 2 | `<a>` | Msaada home | 40 × 32 | ❌ Below threshold |
| 3 | `<a>` | Report (nav) | 80 × 28 | ❌ Height 28 < 44 |
| 4 | `<a>` | Cases (nav) | 76 × 28 | ❌ Height 28 < 44 |
| 5 | `<a>` | Dashboard (nav) | 105 × 28 | ❌ Height 28 < 44 |
| 6 | `<a>` | Households (nav) | 110 × 28 | ❌ Height 28 < 44 |
| 7 | `<a>` | Referrals (nav) | 93 × 28 | ❌ Height 28 < 44 |
| 8 | `<a>` | Supervisor (nav) | 104 × 28 | ❌ Height 28 < 44 |
| 9 | `<a>` | Audit (nav) | 71 × 28 | ❌ Height 28 < 44 |
| 10 | `<a>` | Admin (nav) | 78 × 28 | ❌ Height 28 < 44 |
| 11 | `<a>` | My report (nav) | 98 × 28 | ❌ Height 28 < 44 |
| 12 | `<a>` | Settings (nav) | 89 × 28 | ❌ Height 28 < 44 |
| 13 | `<a>` | Docs (nav) | 69 × 28 | ❌ Height 28 < 44 |
| 14 | `<a>` | CHV submission | 0 × 0 | ⚠️ Hidden via CSS (icon-only?) |
| 15 | `<a>` | Back to CHV submission | 38 × 44 | ✅ |
| 16 | `<button>` | Refresh case list | 38 × 44 | ✅ |
| 17 | `<button>` | All cases (filter combobox) | 258 × 44 | ✅ |
| 18 | `<button>` | Mark attended | 144 × 44 | ✅ |
| 19 | `<button>` | Unable to reach | 155 × 44 | ✅ |
| 20 | `<button>` | Mark attended | 144 × 44 | ✅ |

**Issue M1 — Mobile primary nav links below 44 px touch target.** The 12-link primary navigation bar (Report / Cases / Dashboard / Households / Referrals / Supervisor / Audit / Admin / My report / Settings / Docs) renders each link at 28 px height on a 375-wide viewport. This is below the iOS Human Interface Guideline / WCAG 2.2 AAA 44 × 44 recommendation. (Note: it does satisfy WCAG 2.2 AA's 24 × 24 minimum.) The 12-link horizontal bar also wraps awkwardly on narrow viewports — 12 links at 375 px means each is ~30 px wide and 28 px tall, well below touch-comfort.

**Recommendation:** Replace the desktop horizontal `<nav>` with a hamburger menu + slide-out drawer on viewports ≤ 640 px, giving each nav item full-width 44 px rows.

## Files Produced

- This review: `/home/z/my-project/reviews/qa-route-verification.md`
- Stdout log: `/home/z/my-project/qa-stdout.log`
- Screenshots (14 PNGs in `/home/z/my-project/reviews/screenshots/`):
  - `public_report.png`, `public_docs.png`
  - `authed_root.png`, `authedcases.png`, `authedhouseholds.png`, `autheddashboard.png`, `authedaudit.png`, `authedsupervisor.png`, `authedreferrals.png`, `authedreport_mine.png`, `authedsettings.png`, `authedadmin.png`
  - `mobilereport.png`, `mobilecases.png`

## Findings Summary

- **All 12 routes render without runtime errors** (agent-browser `errors` reported empty for every route).
- **All 12 routes return HTTP 200** on first hit (curl warm-up).
- **No horizontal overflow** on `/report` or `/cases` at 375 × 667.
- **Mobile finding M1:** `/cases` primary nav links are 28 px tall — below 44 px touch-target guideline. Same nav pattern likely affects every authed route on mobile (it's the shared `<PrimaryNav>` component).
- **Mobile `/report` finding:** Brand logo (24 px) and footer "CHV sign in" link (14 px) are below 44 px, but these follow common mobile UX conventions (logos + text footer links).
- **`/admin` RBAC gate** correctly denies access to the `chv` demo account with a friendly "log in as county.admin@msaada.health / msaada123" hint — not a defect.

## Stage Summary

- 12 routes OK, 0 routes with runtime errors.
- 1 mobile usability issue (M1 — nav touch targets on `/cases` at 375 px) for engineering to address.
- Screenshots captured for all 12 routes + 2 mobile views (14 total PNGs).
