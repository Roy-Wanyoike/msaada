# Task: p2a-hh — `/households` management page

Agent: households-page
Task: /households management page

## Work Log
- Read worklog, identity-store.ts, identity-types.ts, all household/encounter API routes, AppNav, dashboard-states, MyRecentObservations, AuthCard (Select patterns), audit/page (skeleton/empty/error pattern), card/button/select/label/input/badge/skeleton/separator ui primitives.
- Created `src/app/households/page.tsx` — a `'use client'` page that:
  - Renders `<AppNav />` from `@/components/msaada/AppNav`.
  - Header "My households" + "New household" button (emerald, 44px).
  - Lists households from `GET /api/households`. Each card shows householdCode (MSD-HH-XXXX), label, county·ward, memberCount, encounterCount, and a View/Close toggle button.
  - Clicking View opens an inline AnimatePresence roster panel — fetches `GET /api/households/[id]` — that lists members (memberCode MSD-M-XXXX, displayName, role, ageBand) with `max-h-96 overflow-y-auto`.
  - Add-member form (displayName Input, role Select from MEMBER_ROLES, ageBand Select from AGE_BANDS) → `POST /api/households/[id]/members`. Bumps memberCount on the parent card.
  - Per-member "Start encounter" button → `POST /api/encounters { householdId, memberId }`. Bumps encounterCount on the parent card.
  - "Start encounter" success pops a modal showing the encounterCode (MSD-ENC-XXXX) + household + member context + a `Start observation →` link to `/?encounter=<ENC_ID>`. Auto-dismisses after 12s, Escape to close.
  - "New household" sheet (modal, body-scroll-locked, Escape to close): county Select (from `COUNTIES`), ward Select (from `WARDS[<county>]`, disabled until county selected), label Input (mnemonic — explicitly documented NOT a personal name, capped at 100 chars) → `POST /api/households`. New household is prepended to the list and auto-selected.
  - States: loading (skeleton ×3 cards), empty (EmptyState CTA), error (ErrorState with Retry), unauthed (UnauthedState with sign-in link).
  - Sticky footer (`mt-auto` pattern), emerald/teal palette throughout (no indigo/blue).
  - framer-motion entrance animations on cards, member rows, sheets, and toasts.
  - 44px touch targets (`min-h-[44px]`/`h-10 min-h-[44px]` on every Button/Select/Label-associated control).
  - Semantic HTML: `<header>`, `<main id="main" tabIndex={-1}>` (skip-to-main target), `<section aria-label>`, `<article>`, `<footer role="contentinfo">`, `<dl/dt/dd>` for encounter context.
  - All fetches are ownership-scoped via the existing API routes (which already call `getSessionChv`). Race-guard via `listReqId` counter. `cache: "no-store"` on all reads.
  - Toasts via `sonner` (already mounted in root layout).

## Lint
- `bun run lint` — PASS (0 errors). Pre-existing TS-only errors elsewhere are unrelated (eslint rules for those are disabled).

## Stage Summary
- CHV can create households, add members, start encounters — all wired to the existing identity-chain endpoints. Encounters link forward to `/` via `?encounter=ENC_ID` so the triage submission form can pick them up.
