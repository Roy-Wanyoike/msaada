# Audit 7 — PII Scrubber + Follow-Up Workflow

**Task ID:** audit-pii-fu
**Reviewer:** pii-followup-auditor (domain: Kenya community health + AI safety)
**Mode:** READ-ONLY (no code modified)
**Date:** 2025-09-22
**Scope:** `src/lib/pii-scrub.ts`, `src/lib/qwen.ts`, `src/app/api/triage/route.ts`, `src/lib/triage-store.ts` (follow-up section), `src/app/api/followups/route.ts`, `src/app/api/followups/[id]/route.ts`, `src/components/msaada/PendingFollowUps.tsx`, `src/components/msaada/CrisisPanel.tsx`, plus cross-checks in `src/app/page.tsx`, `src/components/msaada/FollowUpKpiCard.tsx`, `src/app/api/dashboard/route.ts`, `src/app/supervisor/page.tsx`, `src/app/api/supervisor/roster/route.ts`.

---

## Executive summary

The system meets most of the spec's hard constraints: scrubber runs before the model call, redaction counts (not raw redactions) are logged, the follow-up state machine is correct (`pending → done | missed`, no re-resolve), ownership is enforced at the data layer, the 48h due date is right, `createFollowUp` is idempotent, the crisis override prompt is preserved verbatim, and the panel renders first with Escape-block + 5s countdown + explicit confirm.

However, four findings warrant attention before production:

1. **CRITICAL** — The M-Pesa transaction-code regex is structurally broken against the very examples in its own docstring (`QGR4H9X7ZP`, `SI9K2M4N1P`), so these payment references leak to Qwen.
2. **HIGH** — The `gi` flag on the kinship-name and school-name regexes makes the "proper-name" class case-insensitive, so it matches any 3+ letter Swahili word. Common CHV sentences like *"mama anasema"* / *"baba amerudi"* get the verb redacted as a NAME — both over-redacting (triage context loss) AND leaking the actual name in patterns like *"Acacia Academy alisema"* (where "alisema" is wrongly caught but "Acacia" survives).
3. **HIGH** — Overdue follow-ups have only a passive UI indicator; there is no reminder/notification, no escalation, and no supervisor-facing view of per-CHV overdue items.
4. **HIGH** — The CrisisPanel blocks Escape and clicks but is bypassable via browser refresh / URL navigation (no `beforeunload`/focus-trap). The "cannot be closed without confirmation" claim is therefore incomplete.

---

## Part 1 — PII scrubber (`src/lib/pii-scrub.ts`)

### 1.1 Regex-by-regex mental test against Kenyan CHV observations

| # | Type | Regex | Test input | Result | Verdict |
|---|------|-------|------------|--------|---------|
| 1 | Phone | `/(?:\+?254\|0)[\s-]?([17])\d{2}[\s-]?\d{3}[\s-]?\d{3}/g` | `+254 722 345 678` | `[PHONE]` | ✅ correct |
| 1 | Phone | (same) | `0722345678` | `[PHONE]` | ✅ |
| 1 | Phone | (same) | `020 123 456` (Nairobi landline) | unchanged | ⚠️ under-redacts landlines (acceptable for CHV mobile-first) |
| 1 | Phone | (same) | `722 345 678` (no 0/+254 prefix) | unchanged → caught by ID_RE as 9-digit run → `[ID]` | ⚠️ minor over-redact; rare in CHV usage |
| 2 | Email | `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g` | `baba@gmail.com` | `[EMAIL]` | ✅ |
| 3 | ID | `/(?<!\d)(\d{7,9})(?!\d)/g` | `12345678` (8-digit ID) | `[ID]` | ✅ |
| 3 | ID | (same) | `1234567` (7-digit, older ID) | `[ID]` | ✅ |
| 3 | ID | (same) | age `28`, year `2024` | unchanged (4 digits / 2 digits) | ✅ intentional |
| 3 | ID | (same) | NHIF-like `12345678` | `[ID]` | ✅ co-incidentally caught |
| 4 | Kinship+name | `/\b(mama\|baba\|mtoto\|dada\|ndugu\|shangazi\|mjomba\|nyanya\|babu)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/gi` | `Baba Wanjiru Kamau` | `Baba [NAME]` | ✅ correct |
| 4 | Kinship+name | (same) | `Mama A` | unchanged (single-letter) | ✅ correctly NOT redacted |
| 4 | Kinship+name | (same) | `mama anasema …` | `mama [NAME] …` | ❌ **over-redact** — `i` flag makes `[A-Z][a-z]` match lowercase, so the Swahili verb "anasema" is wrongly caught as a name |
| 4 | Kinship+name | (same) | `Wanjiru came to clinic` (no kinship prefix) | unchanged | ⚠️ under-redact — names without kinship prefix leak (acceptable; conservative) |
| 5 | M-Pesa | `/\b([A-Z]{2}\d{4}[A-Z0-9]{4})\b/g` | `QGR4H9X7ZP` | unchanged | ❌ **under-redact** — regex demands 2 letters + 4 digits + 4 alnum in that exact order; the spec's own example is interleaved (`Q-G-R-4-H-9-X-7-Z-P`), so it does NOT match |
| 5 | M-Pesa | (same) | `SI9K2M4N1P` | unchanged | ❌ same reason — leaks the payment reference |
| 6 | Plot | `/\b(plot\|house\s*no\.?\|door\s*no\.?\|apt\.?)\s*#?\s*(\d+[A-Za-z]?)\b/gi` | `Plot 1234` | `Plot [PLOT]` | ✅ |
| 7 | Plate | `/\bK[A-Z]{2}\s?\d{3}[A-Z]?\d?\b/g` | `KDA 1234` | `[PLATE]` | ✅ |
| 7 | Plate | (same) | `KDA 1234A` (new suffix format) | unchanged | ⚠️ under-redact — newer Kenyan plates with letter-suffix not matched |
| 8 | School | `/\b(shule\|school\|academy\|primary\|secondary\|msingi)\s+(ya\s+)?([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{1,}){0,3})\b/gi` | `Shule ya Msingi Mwangaza` | `Shuleya [SCHOOL]` | ⚠️ redact succeeds but replacement drops the space between `kw` and `ya` → malformed token; also `i` flag means it would also match `shule ya msingi mwangaza` (all lowercase) and any 3+ letter word, including verbs |
| 8 | School | (same) | `Acacia Academy alisema …` | `Acacia Academy [SCHOOL] …` (redacts the verb `alisema`) | ❌ over-redact + under-redact combo — actual school proper noun `Acacia` precedes the keyword, so it is NOT redacted; the following verb is |

### 1.2 Order of operations

Order in `scrubPII` is: phone → email → M-Pesa → plate → plot → school → ID → kinship-name. The phone/M-Pesa/plate/plot passes run **before** the 7-9 digit ID pass, which is correct: otherwise the digit tails of phones/plates/plots would be eaten by ID_RE. The kinship pass running last is fine because the school pass already consumed the keyword+name combination, so a "Shule ya Msingi" segment won't be re-caught by the kinship regex. Order is sound.

### 1.3 Missed Kenya-specific PII types

| Type | Format | Currently caught? | Gap severity |
|------|--------|-------------------|--------------|
| NHIF membership number | 8-9 digits | ✅ co-incidentally via ID_RE | none |
| National ID | 8 digits | ✅ via ID_RE | none |
| Passport number | letter + 7 digits (`A1234567`) or `AB1234567` | ⚠️ partial — the digit run is caught by ID_RE but the letter prefix survives (`A[ID]`) | low |
| KCPE / KCSE index number | 11 digits (`12345678910`) | ❌ ID_RE caps at 9 digits; whole 11-digit run survives | medium (school context, identifying) |
| M-Pesa till / paybill number | 5-7 digit short code | ❌ below ID_RE threshold (and not in MPESA_CODE_RE which requires letters) | medium (payment reference can identify a business a household uses) |
| Birth certificate number | letter + 6-7 digits | ❌ not covered | low |
| Driving licence | variable | ❌ not covered | low |
| Village/estate name (`Kwa Njenga`, `Komarock Phase 4B`) | text | ❌ not covered — PLOT_RE intentionally preserves area names; in tight-knit communities a specific village + a household event can re-identify | medium-hard (no easy regex solution; consider a small gazetteer for known small villages in CHV's county) |
| Hospital/clinic name (`Pumwani Hospital`) | text | ❌ not covered | low |

### 1.4 Scrubber runs before the model call?

`src/app/api/triage/route.ts` lines 97-101:
```ts
const { redacted: scrubbedText, redactionCount } = scrubPII(observation_text.trim());
const { output, fallbackUsed } = await classifyObservation(scrubbedText);
```
✅ **Yes.** Verified — the redacted string is what is passed to `classifyObservation`; the raw `observation_text` is never sent to Qwen.

### 1.5 Redaction counts logged (not redactions themselves)?

`route.ts` lines 151-157 (`console.log` with `scrubbed=${JSON.stringify(redactionCount)}`) and lines 130-147 (`writeAuditEntry({ … piiRedactions: redactionCount })`). Both carry the `redactionCount` object (counts by type), not the redacted substrings. ✅ **Yes.** Compliant with the spec's "log counts, never redactions" rule.

---

## Part 2 — Follow-up workflow

### 2.1 State machine

`FollowUpStatus = "pending" | "done" | "missed"` (line 117).
- New follow-ups enter as `pending` (Prisma default in `createFollowUp`).
- `resolveFollowUp` accepts only `"done" | "missed"`.
- `resolveFollowUp` lines 237-238: `if (existing.status !== "pending") return null;` — a resolved follow-up **cannot** be re-resolved. The API layer returns 404 `NOT_FOUND_OR_NOT_PENDING` when this happens (route.ts line 50-55). ✅ State machine is correct and idempotent on terminal transitions.

### 2.2 Ownership

`resolveFollowUp` line 237: `if (!existing || existing.chvId !== chvId) return null;` — only the assigned CHV can resolve, enforced at the data layer (not just the API layer). `getMyFollowUps` filters by `chvId`. ✅ Ownership enforced; the API route also gates on `getSessionChv()` returning a session. No `getAllFollowUps` or supervisor-bypass path exists for resolving — only `getFollowUpStats` (counts only) and `getSupervisorRoster` (per-CHV triage aggregates, not follow-up details).

### 2.3 48h due date

`createFollowUp` lines 185, 193-194:
```ts
const dueInHours = args.dueInHours ?? 48;
const dueAt = new Date();
dueAt.setHours(dueAt.getHours() + dueInHours);
```
✅ Exactly 48h from creation. No clock-skew risk (uses server `Date`).

**Overdue handling:**
- `getFollowUpStats` lines 717-723 computes `overdue = pending AND dueAt < now`. ✅ Indicator exists in dashboard stats.
- `PendingFollowUps.tsx` `relativeDue()` lines 58-72 returns `{ overdue: boolean, soon: boolean }` and the list item is rendered with red background + `AlertCircle` icon + "Xh Ym overdue" label when overdue. ✅ UI indicator exists.
- ❌ **No reminder/notification.** No background job, no SMS, no email, no push. The CHV only sees the overdue state when they next open `/`.
- ❌ **No escalation.** An overdue follow-up never escalates to a supervisor automatically. The supervisor dashboard (`/supervisor` + `/api/supervisor/roster`) shows per-CHV triage aggregates but **not** per-CHV overdue follow-up counts — see gap 2.6 below.

### 2.4 Idempotency of `createFollowUp`

Lines 187-191:
```ts
const existing = await db.followUp.findFirst({
  where: { triageRecordId: args.triageRecordId, status: "pending" },
  ...
});
if (existing) return toFollowUpDTO(existing);
```
✅ **Idempotent** for the pending state. Re-calling with the same `triageRecordId` returns the existing pending row instead of duplicating.

Minor robustness note (not a bug in practice): the check-then-create is not wrapped in a transaction or Prisma `upsert`. In theory two concurrent calls could both see no existing and both insert. In practice this can't happen here because `createFollowUp` is called exactly once per `/api/triage` request and each request creates a fresh `triageRecordId` upstream (`insertTriageRecord`), so no two requests ever share a `triageRecordId`. The idempotency check is defense-in-depth, working as intended. If `createFollowUp` is ever called from a retry/queue path, add `upsert` or a unique constraint on `triageRecordId` to make it bullet-proof.

### 2.5 `FollowUpKpiCard` completionRate computation

`getFollowUpStats` lines 740-741:
```ts
const resolved = stats.done + stats.missed;
stats.completionRate = resolved > 0 ? Math.round((stats.done / resolved) * 100) : 0;
```
✅ Computation is correct (done / (done + missed)) and divides-by-zero safe.

⚠️ **Denominator excludes pending.** A CHV with 100 pending + 1 done + 0 missed shows `completionRate = 100%`, which overstates operational health. The card does append a small `${done} done · ${missed} missed` hint below the big number, but the headline % can mislead a supervisor skimming the dashboard. Consider exposing both `completionRate` (resolved-only) and a `coverageRate` (done / total) so the dashboard can show "100% completion on 1 resolved of 101 total".

### 2.6 Gap analysis — reminders, escalation, supervisor view

| Capability | Implemented? | Evidence / Gap |
|------------|--------------|----------------|
| Overdue UI indicator on CHV's own list | ✅ | `PendingFollowUps.tsx` red bg + AlertCircle + "Xh Ym overdue" |
| Aggregate overdue count on dashboard | ✅ | `FollowUpKpiCard` "Overdue" stat column (red) |
| Reminder when a follow-up becomes overdue (SMS/email/push/in-app toast on next visit) | ❌ | No `cron`/queue, no `beforeunload`, no `/api/notifications`. CHV has to manually reload `/` to see the overdue state. **GAP.** |
| Auto-escalation to supervisor when overdue crosses a threshold (e.g., 24h past due) | ❌ | No code path. The follow-up just sits `pending` indefinitely. **GAP.** |
| Supervisor view of per-CHV overdue follow-ups | ❌ | `getSupervisorRoster` returns per-CHV triage aggregates (total / routine / needs_followup / needs_facility_referral / escalation / last7d / lastSubmission). It does **not** include `overdueFollowUps` per CHV. `/api/supervisor/roster` does not call `getFollowUpStats` per CHV. A supervisor cannot answer "which of my CHVs has overdue follow-ups?" without writing a new query. **GAP.** |
| Per-CHV completion-rate leaderboard | ❌ | Same as above — no `getFollowUpStats` per-CHV path. |

---

## Part 3 — Crisis panel (`src/components/msaada/CrisisPanel.tsx` + `src/lib/qwen.ts`)

### 3.1 Crisis override in system prompt — verbatim?

`src/lib/qwen.ts` lines 14-21 contain the `TRIAGE_SYSTEM_PROMPT` constant with the `CRISIS OVERRIDE (check first, always): …` block. The instruction text, the `chp_instruction` value ("Do not leave the household unaccompanied. Contact your CHV supervisor and the nearest Level 4+ facility immediately. If immediate danger, call Kenya Red Cross Emergency: 1199."), the `crisis_line` value ("Kenya Red Cross Emergency: 1199 | Befrienders Kenya: +254 722 178 177"), and `record_for_reporting: true` all match the spec quotes reproduced in `worklog.md` (Task 1 stage summary and Task 2-a verification). The file's docstring explicitly says "DO NOT modify the crisis logic" and the only additions to the prompt at call time are JSON-format reinforcements appended AFTER the system prompt body (lines 141-145) — they do not alter the crisis block. ✅ **Verbatim and unmodified.**

### 3.2 Non-dismissable behaviour

| Behaviour | Implemented? | Evidence |
|-----------|--------------|----------|
| No X button | ✅ | No X/close icon in JSX (only an `AlertTriangle` decoration and the confirm `Button`) |
| Escape blocked | ✅ | `useEffect` adds `window.addEventListener("keydown", block, true)` in capture phase; `e.key === "Escape"` → `preventDefault + stopPropagation` (lines 44-53) |
| 5-second countdown | ✅ | `useState(5)`, decrements via `setTimeout(1000)`, `canConfirm = countdown === 0` (lines 30-40) |
| Explicit confirm required | ✅ | Single `<Button onClick={handleConfirm} disabled={!canConfirm}>` with label "I have read this and will act now" (lines 127-136); `handleConfirm` short-circuits when `!canConfirm` |
| Full-screen overlay | ✅ | `fixed inset-0 z-50 bg-red-600` (line 70) |
| `role="alertdialog"` + `aria-modal="true"` + `aria-live="assertive"` | ✅ | Lines 62-66 |
| Refresh / browser-navigation resistance | ❌ | **No `beforeunload` handler.** A CHV pressing F5 / Ctrl+R / back-button / typing a URL will unmount the React tree and the `crisisRecord` state in `src/app/page.tsx` resets to `null`, so the panel disappears without confirmation. The "cannot be closed without confirmation" claim is therefore only true for in-page interactions. **GAP — see finding #4.** |
| Focus trap | ❌ | The panel does not trap Tab focus. A keyboard user can Tab to background elements (e.g., the submission form fields below) and interact with them while the panel is visually covering them. `aria-modal="true"` signals to screen readers but does not enforce DOM focus. Minor a11y gap. |

### 3.3 Renders FIRST in JSX

`src/app/page.tsx` lines 119-127:
```tsx
return (
  <div className="flex min-h-screen flex-col bg-background text-foreground">
    {/* A. CRISIS PANEL — renders FIRST so it always wins z-index. */}
    {crisisRecord?.escalation === true && (
      <CrisisPanel record={crisisRecord} onConfirm={handleCrisisConfirm} />
    )}
    <main …>
```
✅ CrisisPanel is the first child of the root div. Combined with `fixed inset-0 z-50`, it always wins visual stacking over `<main>` and the footer.

Minor documentation inaccuracy (not a bug): because `CrisisPanel` is `position: fixed`, JSX order does not actually affect stacking — `z-50` alone wins over non-positioned or lower-z siblings regardless of source order. The comment is a true statement about intent but technically misleading about the mechanism. No functional impact.

---

## Findings ranked by severity

### 🔴 CRITICAL

**F-1. M-Pesa transaction-code regex misses the spec's own examples (PII leak to Qwen).**
- File: `src/lib/pii-scrub.ts` line 68.
- Regex: `/\b([A-Z]{2}\d{4}[A-Z0-9]{4})\b/g`.
- The docstring says it should catch `QGR4H9X7ZP` and `SI9K2M4N1P`, but neither matches: `QGR4H9X7ZP` is "QG" + "R4H9" (mixed, not 4 digits) + "X7ZP"; the regex requires positions 3-6 to be digits only.
- **Fix:** Replace with `/\b([A-Z]{2,3}[A-Z0-9]{7,8})\b/g` (2-3 leading letters + 7-8 alphanumeric, total 10), then post-filter to require ≥1 digit (to avoid catching ALL-CAPS English words like `WARNING`). Better yet: require it be preceded by a context cue (`mpesa` / `transaction` / `confirmation` / `ref`) within 30 chars, since 10-char uppercase alnum strings are otherwise rare in CHV text.

### 🟠 HIGH

**F-2. Kinship-name and school-name regexes over-redact Swahili verbs (and under-redact the actual name when the proper noun precedes the keyword).**
- Files: `src/lib/pii-scrub.ts` lines 60-61 (KINSHIP_NAME_RE) and 94-95 (SCHOOL_RE).
- Both use the `gi` flag, which makes `[A-Z]` and `[a-z]` case-insensitive. The "proper-name" sub-pattern then matches any 3+ letter word.
- Real CHV sentences like *"mama anasema hajalala"* become *"mama [NAME] hajalala"* — the verb "anasema" is wrongly eaten as a NAME, while the rest of the sentence (which actually carries the triage signal) is damaged.
- Conversely, *"Acacia Academy alisema …"* becomes *"Acacia Academy [SCHOOL] …"* — the actual school proper noun "Acacia" survives because it precedes the keyword, and the following verb "alisema" is wrongly caught.
- **Fix (two-part):**
  1. Drop the `i` flag on both regexes — keep the kinship keyword case-insensitive by writing it as `(?:mama|Mama|Baba|baba|…)` explicitly, OR split into two regexes (one case-insensitive on the keyword, one case-sensitive on the name). The cleanest path: keep `i` for the keyword alternation but remove it from the name capture by writing the name pattern as `([A-Z][a-z]{2,}…)` and using a separate non-`i` flag.
  2. For the school-name pattern, allow the proper noun to PRECEDE the keyword too: `/\b(?:([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{1,}){0,2})\s+)?(shule|school|academy|primary|secondary)\b/gi` — capture a leading capitalized sequence as the school name even when it comes first (e.g., "Acacia Academy").

**F-3. School-name replacement drops whitespace between the keyword and `ya`.**
- File: `src/lib/pii-scrub.ts` line 145.
- Replacement: `` `${kw}${ya ?? ""} [SCHOOL]` `` — but the `(ya\s+)?` capture includes the trailing whitespace, while the `\s+` between `kw` and `(ya\s+)?` is consumed but NOT captured. So "Shule ya Msingi Mwangaza" → `kw="Shule"`, `ya="ya "`, replacement = `"Shule" + "ya " + " [SCHOOL]"` = `"Shuleya [SCHOOL]"` (no space between "Shule" and "ya").
- **Fix:** Either capture the inner `\s+` (rewrite the regex as `(shule|…)(\s+ya\s+)?(\s+name)`) or hard-code the space: `` `${kw} ${ya ?? ""}[SCHOOL]` `` (and trim `ya` so it doesn't double-space).

**F-4. No proactive reminder / escalation when a follow-up becomes overdue.**
- Files: `src/lib/triage-store.ts` (follow-up section), `src/app/page.tsx`, `src/app/api/followups/*`.
- The overdue state is purely reactive — it shows red on `PendingFollowUps` only when the CHV reopens `/`, and shows an aggregate count on the dashboard's `FollowUpKpiCard`. There is no cron, no SMS/email, no in-app toast on next visit that says "you have 3 follow-ups overdue". For a CHV workflow where 48h is the safety threshold, a CHV who doesn't open the app for 5 days will silently accumulate overdue items with no nudge.
- **Fix:** (a) Add a server-side cron (or a Next.js `scheduled` route hit by the existing `webDevReview` cron) that scans `followUp` rows where `status='pending' AND dueAt < now()` and writes a row to an `overdue_nudge` table (or sends an SMS via Africa's Talking / Twilio in production). (b) On `/api/auth/me`, return `overdueFollowUpCount` so the CHV's next page-load surfaces a toast/banner even if they navigate straight to `/dashboard`. (c) After 24h past `dueAt`, flip a `flagged_overdue` boolean (new column) so the supervisor roster can show it.

**F-5. No supervisor view of per-CHV overdue follow-ups.**
- Files: `src/lib/triage-store.ts` (`getSupervisorRoster`, lines 786-879), `src/app/api/supervisor/roster/route.ts`, `src/app/supervisor/page.tsx`.
- `getSupervisorRoster` returns per-CHV triage aggregates (total / routine / needs_followup / needs_facility_referral / escalation / last7d / lastSubmission) but does NOT include `pendingFollowUps` or `overdueFollowUps` per CHV. The supervisor page therefore cannot answer the most operationally important question: "which CHV has unchecked overdue follow-ups?"
- **Fix:** Add `pendingFollowUps`, `overdueFollowUps`, and `completionRate` fields to `SupervisorChvRow`. Implementation: in `getSupervisorRoster`, add a `db.followUp.groupBy({ by: ["chvId", "status"], _count: true, where: { …same window… } })` and a `db.followUp.count({ where: { status: "pending", dueAt: { lt: now }, triageRecord: { submittedById: { in: … } } } })` per CHV. Surface these as two new columns on `/supervisor`.

**F-6. CrisisPanel is bypassable via browser refresh / URL navigation.**
- File: `src/components/msaada/CrisisPanel.tsx`.
- The panel blocks Escape and clicks but has no `beforeunload` handler. A CHV who panics and hits F5 (or clicks the browser back button, or types `/dashboard` in the URL bar) will unmount the React tree; `crisisRecord` in `src/app/page.tsx` resets to `null` and the panel disappears without confirmation.
- The spec's intent ("The ONLY way out is the explicit confirm button") is therefore not enforced against the most common panic reaction (refresh).
- **Fix:** Add a `beforeunload` handler in `CrisisPanel`'s `useEffect` that, while the panel is mounted, calls `e.preventDefault()` and sets `e.returnValue` to a non-empty string. Modern browsers show a generic "Leave site? Changes you made may not be saved" dialog. (Note: this only fires for refresh / close / navigation that crosses the document — it does NOT fire for client-side SPA route changes. Since Msaada's only client-side route change is `window.location.assign("/dashboard")` in `page.tsx` line 116, that already triggers a full document unload and `beforeunload` will fire. ✅)
- Also add a focus trap (`focus()` the confirm button on mount, trap Tab within the dialog) so keyboard users cannot Tab into the background form.

### 🟡 MEDIUM

**F-7. New-format Kenyan vehicle plates with letter suffix not redacted.**
- File: `src/lib/pii-scrub.ts` line 84.
- Regex `/\bK[A-Z]{2}\s?\d{3}[A-Z]?\d?\b/g` requires the suffix to be a single letter AFTER the digits with no fourth digit. Newer Kenyan plates like `KDA 1234A` (4 digits + letter) are not matched: the `\d?` after `[A-Z]?` greedily consumes the 4th digit, then `\b` fails because "A" is a word char.
- **Fix:** Rewrite as `/\bK[A-Z]{2}\s?\d{3}[A-Z]?\d?\b/g` → `/\bK[A-Z]{2}\s?\d{3,4}[A-Z]?\b/g` (allow 3 or 4 digits, optional trailing letter). Add a test for `KDA 1234A`, `KCB 7890`, `KDG 123X`, `KEE 1234XX` (the 2019-series square plates).

**F-8. `FollowUpKpiCard` completionRate denominator excludes pending follow-ups — misleading headline.**
- Files: `src/lib/triage-store.ts` line 741, `src/components/msaada/FollowUpKpiCard.tsx` lines 30-89.
- `completionRate = done / (done + missed)`. With a 100-pending backlog and 1 done, the card shows "100%" as the giant headline. The `${done} done · ${missed} missed` subtext mitigates but is small.
- **Fix:** Expose a second metric `coverageRate = done / total` and show both: big `completionRate %` (resolved-only quality) + small "coverage X% of N total" subtitle. The supervisor's eye should go to coverage first when the backlog is high.

### 🟢 LOW

**F-9. Redundant nested ternary in `insertTriageRecord`.**
- File: `src/lib/triage-store.ts` line 37.
- `chpNextAction: isCrisis ? null : (isCrisis ? null : output.chp_next_action)` — the inner `isCrisis ?` is dead (outer ternary already false).
- **Fix:** Simplify to `chpNextAction: isCrisis ? null : output.chp_next_action,`.

**F-10. Phone regex misses Kenyan landline numbers (`020 …`).**
- File: `src/lib/pii-scrub.ts` line 41.
- The `([17])` digit-class after the `0`/`+254` prefix excludes landline area codes (`020`, `041`, `051`, etc.).
- Impact: low — CHV observations are mobile-first; landlines are rare in community-health workflows. But Level-4+ facility phone numbers (e.g., `020 333 0000`) could be transcribed.
- **Fix:** Optionally extend to `(?:\+?254|0)[\s-]?([1720-9]?\d?)\d{2}…` if you want broader coverage; otherwise leave as-is and document the intentional mobile-first scope.

**F-11. KCPE / KCSE index numbers (11 digits) and M-Pesa till/paybill numbers (5-7 digits) not redacted.**
- File: `src/lib/pii-scrub.ts` lines 51 and 68.
- ID_RE caps at 9 digits, so 11-digit exam index numbers survive. M-Pesa till numbers (no letter prefix) don't match MPESA_CODE_RE.
- Impact: low-medium — KCPE index in particular can identify a specific child when paired with a school.
- **Fix:** For KCPE, extend ID_RE to `(?<!\d)(\d{7,9}|\d{11,12})(?!\d)` cautiously (more aggressive). For till/paybill, add a context-cued regex like `/\b(?:till|paybill|lipa\s*na\s*mpesa)\s*(?:no\.?\s*)?(\d{5,7})\b/gi`.

**F-12. Village / estate / hospital names not redacted.**
- File: `src/lib/pii-scrub.ts` (no rule for these).
- Small-area identifiers (`Kwa Njenga`, `Komarock Phase 4B`, `Pumwani Maternity`) can re-identify a household in tight-knit communities.
- Impact: low (regex-only solution is brittle), but worth a production-hardening TODO.
- **Fix:** Maintain a small gazetteer per county of <50-household village names flagged as sensitive; redact on match. Out of scope for a regex-only scrubber; document as a known limitation.

**F-13. `beforeunload` and focus-trap gaps in CrisisPanel.** (Already covered under F-6.)

**F-14. Comment in `src/app/page.tsx` line 122 is technically misleading.**
- The "renders FIRST so it always wins z-index" comment implies JSX order matters for stacking; in fact `position: fixed + z-50` wins regardless of source order.
- **Fix:** Reword to "renders FIRST so its presence is unambiguous in the DOM and `z-50` wins visual stacking over siblings". No code change required.

---

## Top 5 findings (the headline set)

1. **F-1 (CRITICAL).** M-Pesa regex `/\b([A-Z]{2}\d{4}[A-Z0-9]{4})\b/g` is structurally broken — the spec's own examples `QGR4H9X7ZP` / `SI9K2M4N1P` do not match, so payment references leak to Qwen.
2. **F-2 (HIGH).** The `gi` flag on the kinship-name and school-name regexes makes the proper-name class case-insensitive, so Swahili verbs ("anasema", "amerudi", "alisema") are wrongly redacted as `[NAME]` / `[SCHOOL]` — breaking triage context — while actual proper nouns in patterns like "Acacia Academy alisema" survive unredacted.
3. **F-4 + F-5 (HIGH).** No proactive reminder/escalation when a follow-up becomes overdue, and no supervisor-facing per-CHV overdue view (`getSupervisorRoster` returns triage aggregates only). A CHV who doesn't open the app for days silently accumulates overdue items with no nudge, and a supervisor cannot see which CHV has the backlog.
4. **F-6 (HIGH).** CrisisPanel blocks Escape and clicks but not browser refresh / URL navigation — no `beforeunload` handler and no focus trap. A panicked F5 closes the panel without confirmation, contradicting the spec's "ONLY way out is the explicit confirm button" claim.
5. **F-3 + F-7 (MEDIUM).** School-name replacement drops whitespace ("Shule ya Msingi Mwangaza" → "Shuleya [SCHOOL]") and the plate regex misses the new-format `KDA 1234A` plates. Both are correctness bugs in the redaction output that are easy to fix.

---

## What is working well (so it isn't "fixed" by accident)

- ✅ Scrubber runs BEFORE the model call (verified in `/api/triage` lines 97-101).
- ✅ Redaction counts (not redactions themselves) are logged to both `console` and the `audit_log` table.
- ✅ Follow-up state machine is correct: `pending → done | missed`, terminal, no re-resolve (404 on attempt).
- ✅ Ownership enforced at the data layer (`resolveFollowUp` line 237) and the API layer (`getSessionChv` gate).
- ✅ 48h due date is computed server-side using `Date`, no clock-skew.
- ✅ `createFollowUp` is idempotent for the pending state.
- ✅ `getFollowUpStats.completionRate` is divide-by-zero safe and correctly computed as `done / (done + missed)`.
- ✅ Crisis override block in `TRIAGE_SYSTEM_PROMPT` is preserved verbatim; the only additions are JSON-format reinforcements appended AFTER the system prompt body.
- ✅ CrisisPanel: no X button, Escape blocked in capture phase, 5-second countdown with `disabled={!canConfirm}`, single explicit confirm button, `role="alertdialog"` + `aria-modal="true"` + `aria-live="assertive"`, `fixed inset-0 z-50`.
- ✅ CrisisPanel is the first child of the root div in `src/app/page.tsx`.
