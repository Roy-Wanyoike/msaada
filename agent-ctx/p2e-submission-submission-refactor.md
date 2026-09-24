# Task: p2e-submission — Identity-gated submission flow

**Agent:** submission-refactor
**Spec sections:** 6, 15, 24, 25 (Household → Member → Encounter → Observation identity chain)
**File touched:** `src/components/msaada/SubmissionForm.tsx` (full rewrite of the form body; existing layout + handlers preserved)

## What was already in place (read before coding)

- `src/lib/identity-types.ts` — DTO shapes (`HouseholdDTO`, `HouseholdMemberDTO`, `EncounterDTO`, `ReferralDTO`) + `generateCode(prefix)` + `ID_PREFIXES`.
- `src/lib/identity-store.ts` — `createHousehold`, `getMyHouseholds`, `createMember`, `getMembers`, `createEncounter`, `getMyEncounters`, `getMyReferrals`. Ownership-scoped on `chwId`.
- `src/app/api/households/route.ts` — `GET` returns `{ households: HouseholdDTO[] }` (ownership-scoped); `POST` creates a household for the session CHV.
- `src/app/api/households/[id]/route.ts` — `GET` returns `{ household, members }` where `household` is the raw Prisma row (incl. `county`, `ward`, `label`, `householdCode`).
- `src/app/api/encounters/route.ts` — `GET` returns `{ encounters: EncounterDTO[] }`; `POST { householdId, memberId }` creates an encounter (ownership-checked).
- `src/app/api/triage/route.ts` — accepts an optional `encounterId` in the body. When provided, the triage record is linked to the encounter and a `Referral` is created when the policy engine returns `referral_required` (refs §6, §15).
- `src/lib/types.ts` — `TriageRequest` already had `encounterId?` as an optional field; no type change required.

## Changes to `SubmissionForm.tsx`

### New state
- `households: HouseholdDTO[]`, `householdsLoading`, `householdsError` — populated once on mount via `GET /api/households`.
- `householdId`, `members: HouseholdMemberDTO[]`, `membersLoading`, `memberId`.
- `encounter: EncounterDTO | null`, `startingEncounter`, `identityError`.

### New effects / handlers
1. **Households list effect** — `GET /api/households` on mount; on 401 → `onLogout()`. The list populates the household `<Select>` shown when no encounter is active.
2. **URL preselect effect** — reads `window.location.search` for `?encounter=ENC_ID` (avoids the `useSearchParams` Suspense requirement; safe inside a `"use client"` component). If present, fetches `GET /api/encounters`, finds the matching encounter by `id` **or** `encounterCode`, sets `encounter`/`householdId`/`memberId`, then calls `loadHouseholdDetail(encounter.householdId)` to (a) populate the `members` list for the "Change" path, and (b) default the county/ward selects from the household's county/ward (spec §25 — encounter provides identity; county/ward provides aggregate-scoping).
3. **`loadHouseholdDetail(hid)`** (memoised via `useCallback`) — `GET /api/households/[id]`, sets `members` state, returns `{ county, ward }` so callers can default the demographic-scoping selects.
4. **`handleHouseholdChange(hid)`** — clears `memberId`/`members`, calls `loadHouseholdDetail`, defaults county/ward from the household.
5. **`handleStartEncounter()`** — `POST /api/encounters { householdId, memberId }`; on success sets `encounter` + toast; on failure sets `identityError` + toast. Handles 401 (session expired) by calling `onLogout()`.
6. **`handleChangeEncounter()`** — the "Change" link handler (spec §25): clears `encounter`, observation, voice transcript, sample, inline error; **keeps** `householdId`/`memberId`/`members` so the CHV can quickly restart with the same household (or pick a different member / household). Toasts an info message.
7. **`handleSubmit`** — adds a defense-in-depth `!encounter` guard (the submit button is already disabled) and now includes `encounterId: encounter.id` in the `POST /api/triage` body. All other behaviour unchanged (PII note, 429 retry-after, 401 logout, crisis override → `onCrisis`, `onResult` callback for parent refresh).
8. **`resetForAnother()`** — keeps `encounter` so the CHV can log a second observation for the same person (spec §6 — one encounter → many observations). The "Change" link is the explicit way to clear the encounter.

### New UI
- **Identity confirmation banner (§25)** — an `Alert` rendered ABOVE the county/ward selects whenever `encounter` is set. Format: `Observation for: [memberName] · [householdLabel] · [encounterCode]` with the encounter code in a `<code>` chip. A ghost "Change" button on the right calls `handleChangeEncounter`.
- **Identity selector (§15)** — a dashed-bordered panel shown ABOVE the county/ward selects **only when `encounter` is null**. Contains:
  - Household `<Select>` (lists `households`, placeholder handles loading / empty states).
  - Member `<Select>` (disabled until household picked; lists `members`; placeholder handles loading / empty states).
  - "Start encounter" `<Button>` (disabled until both picks are made or while `startingEncounter`). Calls `POST /api/encounters`.
  - A §15 explainer paragraph.
- **Observation textarea** — `disabled={!encounter}`. Placeholder switches to "Start an encounter above to enable this field" when gated. `aria-required="true"`.
- **Voice transcript textarea** (inside the Collapsible) — also `disabled={!encounter}`.
- **Submit button** — `disabled={status === "loading" || !encounter}`. Three visual states: loading (spinner + "Submitting…"), gated (lock + "Start an encounter to submit"), ready (Send + "Submit observation").
- **County + Ward selects** — kept in place (still needed for aggregate-scoping per §25); default to the household's county/ward when an encounter is active (whether via URL preselect or via the selector).

## Behaviour preserved (verified by reading the prior component)

| Existing behaviour | Status |
|---|---|
| Top bar (Msaada badge, CHV name+county, View dashboard, Report link, Log out) | ✅ unchanged |
| Post-crisis banner (`postCrisisBanner` + Dismiss button) | ✅ unchanged |
| Loading skeleton (during triage POST) | ✅ unchanged |
| `TriageResultCard` render on success (incl. its `fallbackUsed` warning banner) | ✅ unchanged |
| Inline error `Alert variant="destructive"` on triage failure | ✅ unchanged |
| Sample transcript picker (`SAMPLE_TRANSCRIPTS`, loads text into the observation field) | ✅ unchanged |
| Collapsible voice transcript (prepended to observation text on submit) | ✅ unchanged |
| PII privacy note under the submit button (updated wording: now also mentions "encounter link") | ✅ preserved (wording clarified) |
| 429 rate-limit handling (`retryAfter`, inline error + toast, status → "error") | ✅ unchanged |
| 401 session-expired → `onLogout()` | ✅ unchanged |
| Crisis override path (toast → status idle → `onResult(record)` → `onCrisis(record)`) | ✅ unchanged (encounter intentionally preserved so the recorded referral stays traceable) |
| County + Ward selects for demographic-scoping | ✅ kept + now defaults from the selected household |
| `resetForAnother()` clears observation / voice / sample / inline error | ✅ preserved (encounter intentionally kept) |

## Lint
- `cd /home/z/my-project && bun run lint` → **EXIT_CODE=0** (clean, no warnings).
- Dev log shows `GET / 200` after the change; no Turbopack/TS compile errors.

## Notes for downstream agents
- The `/households` page (separate agent) is expected to deep-link to `/?encounter=<id-or-code>` when "Start encounter" is clicked. This component matches by **both** `id` and `encounterCode`, so the page can put either into the URL.
- If the deep-linked encounter is not found (404, stale URL, different CHV), the form falls back to the identity selector with an amber `identityError` message — no crash.
- No new package added; no new route; no DB schema change. Pure client-side refactor of one component, wired to the already-existing identity APIs.
EOF
echo "written"