# Accessibility & Mobile Audit — Msaada

**Task ID:** audit-a11y
**Agent:** a11y-auditor
**Scope:** All 6 pages (`/`, `/dashboard`, `/audit`, `/supervisor`, `/report/mine`, `/settings`) + 17 Msaada components (`.tsx`) + 2 Msaada helpers (`.ts`) + sampled shadcn primitives (`button`, `input`, `label`, `dialog`, `alert-dialog`, `select`, `textarea`, `alert`, `tabs`, `card`, `badge`, `table`, `sonner`).
**Standard:** WCAG 2.1 Level AA (with reference to AAA criterion 2.5.5 Target Size for mobile-responsiveness scoring).
**Mode:** READ-ONLY — no code modified.

---

## Per-page scores

| Route | a11y score | Mobile score | Notes |
|---|---|---|---|
| `/` (CHV submission) | **7/10** | **8/10** | CrisisPanel is missing focus-trap + initial-focus move; AuthCard County/Ward labels lack `htmlFor`; SubmissionForm top-bar buttons are `h-9` (< 44px). |
| `/dashboard` (county) | **9/10** | **9/10** | Strongest page: `sr-only` headings, `role="img"` + `aria-label` on every chart, county table serves as SR fallback for the bar chart, KPI grid `aria-live="polite"`, code-split charts keep the bundle light. Segmented controls `min-h-9` are < 44px. |
| `/audit` (compliance) | **7/10** | **7/10** | Mobile table rows collapse to a 6-cell vertical stack with no per-cell `aria-label` / visible label — SR users lose column meaning. Filter "Escalations only" button `h-9`. Filter `<Select>` triggers `h-9`. |
| `/supervisor` (roster) | **7/10** | **7/10** | Same mobile-table-row issue (8-cell stack without labels). Time-range segmented control `min-h-8 min-w-9` = 32px (worst touch target in the app). Summary KPI cards `grid-cols-3` with no breakpoint — cramped at 320px. |
| `/report/mine` (weekly CHV report) | **8/10** | **9/10** | Has a print stylesheet (`print:hidden` nav/footer/header + print-only header). Default-size "Sign in" / "Retry" buttons (`h-9`) violate 44px. BreakdownBar uses color-dot + text label (colorblind-safe). |
| `/settings` (CHV profile) | **7/10** | **8/10** | Refresh/Sign-out buttons `h-9`; CrisisLine `tel:` anchors ~32px tall. Profile gradient header text contrast OK (white on emerald-700/teal-700 ≈ 6:1). |

**Average a11y score: 7.5/10** · **Average mobile score: 8.0/10**

---

## Top 10 issues (ranked by severity)

### 1. CrisisPanel: no focus trap / no initial focus move into dialog  🔴
**File:** `src/components/msaada/CrisisPanel.tsx:44-53, 60-72`
**WCAG:** 2.4.3 Focus Order (Level A) · 4.1.2 Name, Role, Value (Level A) · [WAI-ARIA alertdialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)

The component sets `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`, `aria-live="assertive"` (all correct), and blocks Escape via a capture-phase listener. **However:**
- When the panel mounts, focus stays on the Submit button behind the overlay — there is no `useEffect` that calls `confirmButtonRef.current?.focus()`.
- Tab/Shift+Tab are not constrained — a keyboard user can cycle to interactive elements beneath the `fixed inset-0 z-50` overlay.
- The overlay's `onMouseDown` stopPropagation only blocks pointer events, not keyboard focus.

**Fix:** Add a `ref` to the confirm button and `focus()` it on mount; implement a Tab keydown handler that wraps focus between the first and last focusable descendant of the dialog; or use `react-focus-lock`/`@radix-ui/react-dialog` (which traps focus natively). The ARIA APG example for `alertdialog` mandates both `initialFocus` and a focus cycle.

---

### 2. CrisisPanel confirm button uses HTML `disabled` during the 5s countdown — not keyboard-focusable  🔴
**File:** `src/components/msaada/CrisisPanel.tsx:127-136`
**WCAG:** 2.1.2 No Keyboard Trap (Level A) · 4.1.2 Name, Role, Value (Level A)

```tsx
<Button ... disabled={!canConfirm} ...>
  {canConfirm ? "I have read this and will act now" : `Wait ${countdown}s…`}
</Button>
```

The native `disabled` attribute removes the button from the tab order AND prevents `:focus-visible` styling. During the 5-second countdown, a keyboard/screen-reader user lands in the dialog with **no focusable element** — the ARIA pattern is violated and the user is effectively trapped ( Escape is also blocked by design). The `aria-disabled` attribute on a still-focusable button is the correct approach for a "waiting" state.

**Fix:** Replace `disabled={!canConfirm}` with `aria-disabled={!canConfirm}` and keep the button focusable; gate the click handler with `if (!canConfirm) return;` (already done at line 56-58). Also add `aria-live="polite"` to the countdown label so SR users hear "Wait 5s… 4s… 3s…".

---

### 3. No "Skip to main content" link on any page  🟠
**Files:** `src/app/layout.tsx`, all 6 `page.tsx` files
**WCAG:** 2.4.1 Bypass Blocks (Level A)

The root layout renders `<html lang="en">` → `<body>` → `{children}` + `<Toaster />`. There is no `<a href="#main" class="sr-only focus:not-sr-only focus:absolute ...">Skip to main content</a>` as the first focusable element. On `/dashboard`, `/audit`, `/supervisor` etc. a keyboard user must Tab through all 5 AppNav links + the brand + the "CHV submission" back-link before reaching the page content.

**Fix:** Add a skip link at the top of `src/app/layout.tsx` body that targets `<main id="main">`. Give every page's `<main>` element the same `id="main"` (or use a `tabIndex={-1}` on main so the skip-link target receives focus).

---

### 4. AuthCard County/Ward `<Label>` elements are not associated with their Selects  🟠
**File:** `src/components/msaada/AuthCard.tsx:266, 287`
**WCAG:** 1.3.1 Info and Relationships (Level A) · 3.3.2 Labels or Instructions (Level A) · 4.1.2 Name, Role, Value (Level A)

```tsx
<Label>County</Label>           // no htmlFor
<Select ...>
  <SelectTrigger className="min-h-11 w-full"> ... </SelectTrigger>
```

Contrast with the same pattern in `SubmissionForm.tsx:315` which **does** use `<Label htmlFor="county">`. The Radix Label primitive (via `@radix-ui/react-label`) only establishes the `for` association when `htmlFor` is set — there is no automatic "label-next-element" association in React.

**Fix:** Either give each AuthCard `<Label>` an `htmlFor` matching a new `id` on the corresponding `SelectTrigger`, or wrap the Select inside the Label (`<Label>County <Select>…</Select></Label>` — Radix's `Label` will then implicitly associate).

---

### 5. `/audit` and `/supervisor` tables: mobile rows lack per-cell `aria-label` / visible labels  🟠
**Files:** `src/app/audit/page.tsx:250-316`, `src/app/supervisor/page.tsx:226-285`
**WCAG:** 1.3.1 Info and Relationships (Level A) · 2.4.4 Link Purpose (Level A) · 1.3.2 Meaningful Sequence (Level A)

Both pages use the same pattern:
- A desktop header row (`hidden md:grid md:grid-cols-[…]` with column labels: When/Actor/Event/County·Ward/Verdict/Flags).
- A body `<ul>` whose rows are `<div class="grid … md:grid-cols-[…]">` — i.e. **6-col grid on desktop, but a default 1-column stack on mobile** (audit) or single-column with `items-center` (supervisor).

On mobile (and for a screen reader user regardless of viewport), each cell is a bare `<span>` whose text alone ("10:30", "chv·vm0m", "Crisis override", "Kilifi · Malindi Town", "Crisis") does not convey its column meaning. The header row is visually hidden with `hidden` (not `sr-only`) so SR users lose the column labels entirely.

**Fix:** Either:
- Add `sr-only` labels inside each cell — e.g. `<span className="sr-only">When: </span>` before the value, OR
- Use the responsive-table pattern with `data-label` attributes + CSS `::before { content: attr(data-label) }` for visible mobile labels, OR
- Wrap the cells in a real `<table>` on all viewports with `<th scope="col">` headers (proper SR semantics) and apply the grid-stacked layout via CSS only at `md:` breakpoints.

---

### 6. Touch targets < 44px across several interactive controls  🟡
**Files (worst offenders):**
- `src/app/supervisor/page.tsx:176-181` — segmented control `min-h-8 min-w-9` (32px tall, 36px wide)
- `src/app/audit/page.tsx:213` — filter "Escalations only" `Button` `h-9` (36px)
- `src/app/audit/page.tsx:183, 199` — Select triggers `h-9`
- `src/app/settings/page.tsx:190, 199` — Refresh/Sign-out `h-9`
- `src/app/report/mine/page.tsx:177, 184` — Sign in / Retry default-size buttons (`h-9` from `buttonVariants`)
- `src/components/msaada/SubmissionForm.tsx:223, 226, 231` — top-bar View-dashboard/Report/Log-out `h-9`
- `src/components/msaada/PendingFollowUps.tsx:336, 343` — Mark done / Mark missed `h-8` (from `size="sm"`)

**WCAG:** 2.5.5 Target Size (Level AAA — informational for AA, but mobile-responsiveness best practice requires ≥44×44 px for primary actions on touch screens)

Note: WCAG 2.1 AA does not strictly require 44px; AAA 2.5.5 does. The mobile score in this audit **does** dock points for sub-44px primary-action touch targets. The dashboard's action buttons (CSV / Audit / Supervisor / Refresh) correctly use `h-10 min-h-[44px]`, so the dashboard is exemplary — but inconsistency across pages is itself a finding.

**Fix:** Normalize on `h-10 min-h-[44px] px-3` for all touch-target primary actions (matches the dashboard's pattern). For dense segmented controls where 44px is too tall, accept 36px only if the touch area has ≥8px of surrounding padding (the "spacing exception" in 2.5.5).

---

### 7. SubmissionForm County/Ward/Sample Selects and textarea have no `required` attribute  🟡
**File:** `src/components/msaada/SubmissionForm.tsx:316-360, 372-379`
**WCAG:** 3.3.2 Labels or Instructions (Level A) · 3.3.4 Error Prevention (Level AA — recommended for forms that submit health data)

County and Ward `<Select>` components have a placeholder ("Select county" / "Select ward") but no `required` attribute. The observation `<Textarea>` (line 372) likewise has no `required` attribute — validation is performed manually in `handleSubmit` (lines 114-125), which is invisible to the browser's form-validation UI and to assistive tech that relies on `aria-required` / the native `required`.

**Fix:** Either add `required` (and `aria-required="true"`) to each, OR add `aria-required="true"` and rely on the existing manual validation in `handleSubmit` (and surface `aria-invalid` after a failed submission).

---

### 8. AppNav "CHV submission" back-link is `hidden sm:inline-flex` — invisible on mobile  🟡
**File:** `src/components/msaada/AppNav.tsx:95-101`

```tsx
<Link href="/" className="ml-auto hidden shrink-0 items-center gap-1 ... sm:inline-flex">
  <ArrowLeft className="size-3.5" aria-hidden />
  CHV submission
</Link>
```

On viewports < 640px the only way back to `/` from `/dashboard`, `/audit`, `/supervisor`, `/report/mine`, or `/settings` is the Msaada brand link (also `href="/"`) at the far left — but its visible affordance is just a small heart icon, and its `aria-label="Msaada home"` is generic. A mobile user loses the explicit "back to CHV submission" label that desktop users see.

**Fix:** Either: (a) keep the back-link visible at all viewports (drop the `hidden sm:inline-flex`), (b) replace it with an icon-only `Link` with `aria-label="Back to CHV submission"` for mobile, or (c) rely on the brand link but add `title="Msaada — back to CHV submission"` and a visible "Home" label.

---

### 9. Only the CountyBarChart has a tabular screen-reader fallback  🟡
**Files:** `src/components/msaada/top-tags-chart.tsx`, `classification-donut.tsx`, `county-bar-chart.tsx` (the latter via `CountyTable`)

The dashboard's `CountyTable` mirrors `byCounty` data as a real HTML `<table>` and so serves as the SR fallback for the county bar chart (good — worklog Task 2-c explicitly notes this). However:
- `TopTagsChart` (top 12 aggregate tags) — no SR fallback; relies only on `aria-label="Top aggregate triage tags. {summary}"`.
- `DailyTrendChart` (14-day series) — same.
- `ClassificationDonut` — has a visible `<ul>` legend (good for sighted users), which partially mitigates the gap.

For a SR user, the long aria-summary ("Crisis self harm: 4; Fatigue and appetite loss: 2; … 12 items") is hard to scan and impossible to navigate cell-by-cell.

**Fix:** Either: (a) add a `sr-only` `<table>` per chart with the same data (template it once), or (b) collapse to the top-3 + "+9 more" inside the aria-label and link to a full table below.

---

### 10. Borderline color contrast in a few specific tokens  🟡
**Files:** `src/app/dashboard/page.tsx:412, 822`, `src/app/audit/page.tsx:142`, `src/app/supervisor/page.tsx:107`, `src/app/report/mine/page.tsx:140, 296`

- `text-foreground/70` (70% opacity of `oklch(0.145)` on `oklch(1)` background) — measured ≈ **4.5:1**, right at the AA threshold. Pre-round-2 the subtitle was `text-muted-foreground` (oklch(0.556) ≈ 4.6:1); round-2 explicitly bumped it to `text-foreground/70`. Recompute to be safe.
- `FreshnessBadge` (dashboard/page.tsx:826-837) — `text-amber-700 dark:text-amber-300` on `bg-amber-50 dark:bg-amber-950/40`. The `dark:bg-amber-950/40` is **translucent** (40% opacity) over the page background, which can shift effective contrast under different theme wallpapers. WCAG 1.4.3 contrast is computed against the *actual* rendered color, not the source token; translucent dark-mode backgrounds need explicit verification.
- `text-muted-foreground` (`oklch(0.556 0 0)` ≈ 4.6:1 on white) used for chart axis ticks (`fill: "currentColor"` in `county-bar-chart.tsx:114, 218`, `top-tags-chart.tsx:57, 65`, and donut center label) — passes AA but is the **lowest-contrast text** in the app.
- Footnote text at `text-[10px]` (audit/page.tsx:250, supervisor/page.tsx:226) — at 10px the AA small-text threshold of 4.5:1 must apply; this is fine on `text-muted-foreground` but `text-[9px]` (audit line 301, 307) is sub-14px and may be treated as "non-text" by some auditors (acceptable since it's a label not body copy, but borderline).

**Fix:** Bump `text-foreground/70` → `text-foreground/80` for safety margin; replace translucent dark-mode backgrounds (`dark:bg-*-950/40`) with solid `dark:bg-*-950` for status badges; verify the rendered contrast of chart axis ticks at the actual font size (12px → AA requires 4.5:1).

---

## Specific fixes needed (consolidated checklist)

1. **CrisisPanel** — add `initialFocus` + Tab focus trap (use `react-focus-lock` or a 10-line Tab keydown handler); replace `disabled` with `aria-disabled` on the confirm button; add `aria-live="polite"` to the countdown label.
2. **Root layout** — add a skip-link as the first focusable element in `<body>`; give every page's `<main>` a stable `id` + `tabIndex={-1}`.
3. **AuthCard** — give the County/Ward `<Label>` elements `htmlFor` props matching their Selects (mirror the SubmissionForm pattern).
4. **/audit + /supervisor tables** — add `sr-only` per-cell labels (e.g. `<span className="sr-only">When:</span>`) inside each row cell, OR convert to a real `<table>` with `<th scope="col">` headers (preferred).
5. **Touch targets** — normalize all primary-action buttons to `h-10 min-h-[44px] px-3` (audit filter button, supervisor segmented control, settings session buttons, report sign-in/retry buttons, SubmissionForm top-bar buttons, PendingFollowUps Mark-done/missed buttons).
6. **SubmissionForm** — add `required` (or `aria-required="true"`) to county/ward/textarea; surface `aria-invalid` on failed validation.
7. **AppNav** — make the "CHV submission" back-link visible on mobile (or add an icon-only fallback).
8. **Charts** — add `sr-only` `<table>` fallbacks for `TopTagsChart` and `DailyTrendChart` (mirror the CountyTable pattern).
9. **Contrast** — bump `text-foreground/70` → `text-foreground/80`; replace translucent dark-mode badge backgrounds with solid tokens; verify chart-axis-tick contrast at 12px.
10. **Bonus** — add a visible scroll affordance to AppNav's mobile overflow (`scrollbar-none` hides the scrollbar; consider a gradient fade-edge or a horizontal-scroll cue).

---

## What's already excellent (no action)

- **Semantic landmarks**: every page has `<header>`, `<main>` (`flex-1`), `<footer>` (`mt-auto`); AppNav uses `<nav aria-label="Primary">`; dashboards use `<section aria-label="…">` with `sr-only` `<h2>` headings for the KPI grid and chart groupings.
- **Color-only encoding is avoided**: every status color is paired with an icon (ShieldCheck / Activity / Stethoscope / AlertTriangle) AND a text label (e.g. "Routine", "Crisis") — colorblind-safe across `TriageResultCard`, `AuditStrip`, `MyRecentObservations`, `MyImpactCard`, `PendingFollowUps`, `FollowUpKpiCard`, and the `Supervisor` roster rows.
- **Crisis panel ARIA attributes** — `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby="crisis-title"`, `aria-describedby="crisis-desc"`, `aria-live="assertive"` all correctly applied.
- **Charts** — every Recharts container has `role="img"` + a full-text `aria-label` summary; `ResponsiveContainer width="100%" height={300}` inside `min-h-[300px]` containers, code-split via `next/dynamic`.
- **AppNav** — sticky, horizontally scrollable on mobile (`overflow-x-auto scrollbar-none`), active state derived from `usePathname()` with `aria-current="page"`.
- **Forms (where present)** — `autoComplete` is correctly set: `email`, `current-password`, `new-password`, `name` on AuthCard login/signup. Login/signup inputs use `<Label htmlFor>` + `id` correctly.
- **Touch targets on the dashboard action bar** — `h-10 min-h-[44px] px-3` consistently applied (CSV, Audit, Supervisor, Refresh, Back).
- **`<html lang="en">`** and document titles via `metadata` on each layout/page.
- **Sonner toasts** — `role="status"` + `aria-live="polite"` (Sonner default), so dynamic toasts are announced.
- **Dark mode** is broadly token-driven via `dark:` variants on the same tone classes.
- **Print stylesheet** on `/report/mine` — `print:hidden` on nav/footer/header, `print:block` on the print-only header block.
