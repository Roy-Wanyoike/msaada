# Work Record — fix-pii

- **Task ID:** fix-pii
- **Agent:** pii-fixer
- **Scope:** `src/lib/pii-scrub.ts` ONLY (single-file fix).
- **Date:** 2025-09-22

## Context reviewed

- `/home/z/my-project/worklog.md` (architecture + 10 prior review rounds + scrubber-internal invariants)
- `/home/z/my-project/reviews/audit-7-pii-fu.md` (PII + follow-up auditor — flagged 4 regex bugs + 1 replacement bug as CRITICAL/HIGH/MEDIUM)
- `/home/z/my-project/src/lib/pii-scrub.ts` (the target file, 176 lines pre-fix)
- `/home/z/my-project/agent-ctx/fix-triage-api-triage-api-fixer.md` (sibling fix — same `scrubPII` caller; verified no signature drift would break their fix)
- `/home/z/my-project/src/app/api/triage/route.ts` (caller; verified `import { scrubPII }` + `scrubPII(observation_text.trim())` shape unchanged)

## Bugs fixed

### Bug 1 (CRITICAL) — M-Pesa regex structurally broken against its own docstring examples

- **Before:** `const MPESA_CODE_RE = /\b([A-Z]{2}\d{4}[A-Z0-9]{4})\b/g;`
  Demanded exactly 2 letters + exactly 4 digits + 4 alphanumeric at positions 3-6. Real M-Pesa codes interleave letters and digits — `QGR4H9X7ZP` has `R4H9` at positions 3-6 (mixed, not all digits), so neither spec example matched. Payment references leaked to Qwen.
- **After:** `const MPESA_CODE_RE = /\b([A-Z]{2,3}[A-Z0-9]{7,8})\b/g;`
  2-3 leading uppercase letters + 7-8 more uppercase alphanumerics = 9-11 char total, covering both `QGR4H9X7ZP` (3+7=10) and `SI9K2M4N1P` (2+8=10).
- **Post-filter:** `if (!/\d/.test(match)) return match;` inside the replace callback — requires ≥1 digit so all-caps English words like "WASHINGTON" (10 chars, no digit) are NOT redacted.

### Bug 2 (HIGH) — `gi` flag on kinship + school regexes over-redacts Swahili verbs

- **Before:** `KINSHIP_NAME_RE` and `SCHOOL_RE` both had the `gi` flag, making the `[A-Z][a-z]{2,}` "proper name" class case-insensitive — so it matched any 3+ letter word. `mama anasema` → `mama [NAME]` (verb "anasema" wrongly redacted). Worse, `Academy Acacia alisema` → `Academy [SCHOOL]` (verb eaten, real proper noun "Acacia" leaking because it precedes the keyword).
- **After:** Split the validation into a SECOND regex (case-sensitive, no `i` flag) used as a PREFIX extractor inside the callback:
  - `const PROPER_NAME_RE = /^[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?/;` (kinship)
  - `const SCHOOL_NAME_RE = /^[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{1,}){0,3}/;` (school)
  
  The regex itself keeps the `i` flag so `mama`/`Mama`/`MAMA` and `shule`/`Shule`/`SHULE` all trigger the keyword match, but the captured `name` group is re-validated by the case-sensitive regex. The PREFIX-extraction approach (no `$` anchor) handles the corner case `mama Wanjiru anasema` correctly:
  - The `i`-flag regex greedily captures `name = "Wanjiru anasema"` (both match case-insensitively).
  - The case-sensitive PREFIX regex matches only `"Wanjiru"` (stops at the lowercase 'a' of "anasema").
  - The replacement returns `` `${kinship} [NAME]${name.slice(prefix.length)}` `` = `"mama [NAME] anasema"` — the proper noun is redacted, the verb is preserved.
  
  If NO Title-case prefix exists (`mama anasema` → captured `name = "anasema"`), the whole match is left unchanged (verb preserved, no name to redact).

### Bug 3 (MEDIUM) — School replacement dropped whitespace

- **Before:** `SCHOOL_RE` had `(ya\s+)?` as the optional linkword capture — this consumed `"ya "` with the trailing space, and combined with the `\s+` between the keyword and `(ya\s+)?`, the replacement `` `${kw}${ya ?? ""} [SCHOOL]` `` produced `"Shuleya [SCHOOL]"` with the space between `Shule` and `ya` swallowed.
- **After:** 
  - Regex adjusted: `/\b(shule|school|academy|primary|secondary|msingi)\s+(ya)?\s*([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{1,}){0,3})\b/gi` — the `ya` is captured WITHOUT surrounding whitespace (`(ya)?` instead of `(ya\s+)?`), and `\s*` between `(ya)?` and the name handles any trailing whitespace separately.
  - Replacement rewritten: `` `${kw}${ya ? " " + ya : ""} [SCHOOL]${name.slice(prefix.length)}` `` — re-inserts exactly one space between the keyword and the linkword, with the literal ` [SCHOOL]` providing the space before the placeholder.

### Bug 4 (MEDIUM) — Plate regex missed new-format `KDA 1234A` plates

- **Before:** `const PLATE_RE = /\bK[A-Z]{2}\s?\d{3}[A-Z]?\d?\b/g;`
  Greedily consumed the 4th digit (`\d?` after `[A-Z]?`), then `\b` failed against the trailing letter. So `"KDA 1234A"` leaked.
- **After:** `const PLATE_RE = /\bK[A-Z]{2}\s?\d{3,4}[A-Z]?\b/g;`
  Allows 3 OR 4 digits followed by an optional single letter suffix, with `\b` matching either at the digit-end or the letter-end. Verified to match: `KDA 1234` (old, 4 digits), `KCB 7890` (old, 4 digits), `KDG 123X` (3 digits + letter), `KDA 1234A` (new, 4 digits + letter).

## New export — `scrubNote(text: string): string`

Added for use on follow-up resolution notes by a sibling fix (per task spec: "This will be imported by another agent's fix").

- Runs a SUBSET of `scrubPII`: phones, emails, M-Pesa (with the same ≥1 digit post-filter), plates, plots, schools (with the same case-sensitive prefix re-check + space-fixed replacement), and kinship names (with the same case-sensitive prefix re-check).
- Intentionally SKIPS the 7-9 digit `ID_RE` pass — follow-up notes may legitimately contain ages ("mtoto wa miaka 7"), bed-net counts, household sizes, or other 7-9 digit numbers that are NOT national IDs.
- Returns only the redacted text (no `ScrubResult`/counts needed for the follow-up caller).
- Mirrors the regex application order in `scrubPII` (minus the ID pass): phone → email → M-Pesa → plate → plot → school → kinship.

## Untouched logic (per task constraints)

- `ScrubResult` interface — unchanged (8 redaction types: phone, email, idNumber, namePattern, mpesaCode, plotNumber, vehiclePlate, schoolName).
- `scrubPII` export signature — unchanged (`(input: string) => ScrubResult`).
- `PHONE_RE`, `EMAIL_RE`, `ID_RE`, `PLOT_RE` regexes — unchanged (no bugs flagged against them in this audit; the audit's F-10 landline / F-11 KCPE-extension findings were explicitly out-of-scope for this task per the task spec).
- Regex application ORDER in `scrubPII` — unchanged (phone → email → M-Pesa → plate → plot → school → ID → kinship); the auditor confirmed this order is sound.

## Verification

- `bun run lint` → PASS (exit 0, no errors, no warnings). Output: `$ eslint .` only.
- 15-case smoke test (all corner cases from the audit + the prefix-extraction corner case `mama Wanjiru anasema`):
  - M-Pesa `QGR4H9X7ZP` → `[MPESA]` ✓
  - M-Pesa `SI9K2M4N1P` → `[MPESA]` ✓
  - All-caps no-digit `WASHINGTON` → unchanged ✓ (post-filter works)
  - `mama anasema hajalala` → unchanged ✓ (verb preserved)
  - `mama Wanjiru anasema` → `mama [NAME] anasema` ✓ (name redacted, verb preserved)
  - `baba John Smith alikuja` → `baba [NAME] alikuja` ✓ (multi-word)
  - `anashinda Shule ya Msingi Mwangaza` → `anashinda Shule ya [SCHOOL]` ✓ (whitespace + multi-word)
  - `Mwalimu wa Academy Acacia alisema` → `Mwalimu wa Academy [SCHOOL] alisema` ✓ (preceding keyword issue acceptable per audit; verb preserved)
  - `shule anasema sana` → unchanged ✓ (verb preserved)
  - `KDA 1234A` → `[PLATE]` ✓ (new format)
  - `KDA 1234` → `[PLATE]` ✓ (old format)
  - `KDG 123X` → `[PLATE]` ✓ (3 digits + letter)
  - `scrubNote("mtoto wa miaka 7, ID 12345678")` → unchanged ✓ (8-digit run NOT redacted in scrubNote)
  - `scrubPII("ID 12345678 ya sasa")` → `ID [ID] ya sasa` ✓ (scrubPII still redacts IDs)
  - `scrubNote("Piga 0722 123 456 sasa")` → `Piga [PHONE] sasa` ✓ (phone still redacted in scrubNote)
- All 15 cases PASS. Test file deleted after verification (no test code committed, per project rule).

## Stage Summary

- The PII scrubber now correctly handles all 8 identifier types (phones, emails, IDs, kinship names, M-Pesa codes, plot numbers, vehicle plates, school names) without breaking triage context.
- The 4 regex bugs + 1 replacement bug flagged by audit-7 are all resolved.
- The new `scrubNote()` export is ready for the follow-up workflow fix to import.
- Lint passes cleanly with zero errors/warnings.
