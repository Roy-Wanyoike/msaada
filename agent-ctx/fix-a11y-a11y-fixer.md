# Task fix-a11y — a11y-fixer

## Scope
Fixed the 4 issues flagged by `reviews/audit-6-a11y.md` that were scoped to this
task: Radix Toaster mount, skip-to-main link, AuthCard `htmlFor`, and mobile
column labels on `/audit` + `/supervisor` tables.

## Files modified
1. `src/app/layout.tsx` — imported `Toaster as RadixToaster` from
   `@/components/ui/toaster`, rendered `<RadixToaster />` alongside the
   existing Sonner `<Toaster />`. Added a skip-to-main `<a href="#main">`
   as the first focusable element in `<body>` with the
   `sr-only focus:not-sr-only focus:absolute focus:z-50 …` pattern. Added
   a code comment that pages should render `<main id="main">` as the target.
2. `src/components/msaada/AuthCard.tsx` — added `htmlFor="su-county"` /
   `id="su-county"` on the County Label + SelectTrigger, and the same for
   Ward (`su-ward`). Mirrors the SubmissionForm pattern.
3. `src/app/audit/page.tsx` — inserted an inline mobile-only label
   `<span className="inline md:hidden text-muted-foreground mr-1">…:</span>`
   before each of the 6 cells' values (When / Actor / Event / County·Ward /
   Verdict / Flags). For the Verdict + Flags cells (flex containers), the
   label becomes a flex item that disappears at `md:`. Added `items-center`
   to the Flags cell so the label aligns with the badges.
4. `src/app/supervisor/page.tsx` — same pattern across all 8 cells
   (CHV / County·Ward / Total / Routine / Follow-up / Referral / Escalation /
   Last active). For "Total" and "Escalation" added `font-normal text-xs` to
   the label so the visually-bold numeric value remains the focal point.
   For "Last active" switched `text-right` → `text-left md:text-right` so the
   mobile label + value reads naturally left-aligned.

## Lint
`bun run lint` → exit 0, no warnings or errors.

## Dev server
`/home/z/my-project/dev.log` shows clean compile + `GET / 200` after edits.

## Out-of-scope (left for other tasks/agents)
- CrisisPanel focus-trap + `aria-disabled` (audit issues #1, #2).
- Touch-target normalization (audit issue #6).
- SubmissionForm `required`/`aria-required` (audit issue #7).
- AppNav back-link mobile visibility (audit issue #8).
- Chart `sr-only` table fallbacks (audit issue #9).
- Contrast token bumps (audit issue #10).
- Adding `id="main"` to each page's `<main>` — the task explicitly limited
  edits to `layout.tsx` for this fix; added a comment in layout noting the
  target convention. A future agent should add `id="main"` to each page.
