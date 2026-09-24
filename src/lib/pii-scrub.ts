/**
 * PII scrubber — runs BEFORE the observation text is sent to the model.
 *
 * Even though the raw observation text is never persisted, it IS sent to Qwen.
 * This pass redacts obvious personal identifiers (Kenyan phone numbers, email
 * addresses, national-ID-like numbers, "mama X" / "baba X" name patterns) so
 * the model never sees them. This is defense-in-depth on top of the
 * never-persist invariant, and matches the production-hardening TODO in README.
 *
 * The redaction is conservative: it only removes identifiers, not behavioral
 * context, so triage classification quality is preserved. Replacements are
 * generic ("[NAME]", "[PHONE]", "[EMAIL]", "[ID]") so the model still
 * understands the sentence structure.
 */

export interface ScrubResult {
  /** The redacted text — this is what gets sent to the model. */
  redacted: string;
  /** Count of redactions made, broken down by type. */
  redactionCount: {
    phone: number;
    email: number;
    idNumber: number;
    namePattern: number;
    mpesaCode: number;
    plotNumber: number;
    vehiclePlate: number;
    schoolName: number;
  };
  /** True if at least one redaction was made. */
  hadRedactions: boolean;
}

/**
 * Kenyan phone number patterns:
 *  - +254 7XX XXX XXX / +254 1XX XXX XXX
 *  - 2547XXXXXXXX / 2541XXXXXXXX
 *  - 07XX XXX XXX / 01XX XXX XXX
 * Allows spaces, dashes, or no separators.
 */
const PHONE_RE = /(?:\+?254|0)[\s-]?([17])\d{2}[\s-]?\d{3}[\s-]?\d{3}/g;

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Kenyan national ID is 8 digits. We match 7-9 digit runs that aren't part of
 * a longer number (negative lookarounds) to avoid catching years/ages too
 * aggressively. Ages (1-2 digits) and years (4 digits) are intentionally NOT
 * redacted.
 */
const ID_RE = /(?<!\d)(\d{7,9})(?!\d)/g;

/**
 * Case-sensitive proper-name PREFIX extractor. Used in the kinship + school
 * callbacks AFTER a case-insensitive keyword match — the `i` flag on those
 * regexes makes the `[A-Z][a-z]{2,}` class case-insensitive, which would
 * otherwise wrongly catch Swahili verbs like "anasema" / "amerudi" /
 * "alisema". We re-match the captured "name" with this case-sensitive regex
 * (no `i` flag, no `$` anchor) to find the LONGEST Title-case prefix; any
 * trailing lowercase verb is left intact. If no Title-case prefix exists,
 * the whole match is left unchanged (Bug 2 fix).
 */
const PROPER_NAME_RE = /^[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?/;
const SCHOOL_NAME_RE = /^[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{1,}){0,3}/;

/**
 * Name patterns common in CHV observations:
 *  - "mama Wanjiru", "baba Kamau", "mtoto Amani" (Swahili kinship + name)
 *  - "Mama A", "Baba B" (single-letter placeholder — keep as-is, already de-id'd)
 * We redact a proper-name following mama/baba/mtoto/dada/ndugu/shangazi/mjomba/
 * nyanya/babu, but NOT a single capital letter (those are already placeholders).
 *
 * The `i` flag is kept so "mama"/"Mama"/"MAMA" all trigger the keyword match,
 * but the captured "name" is re-validated case-sensitively in the callback via
 * `PROPER_NAME_RE` — so "mama anasema" (lowercase verb) is left intact while
 * "mama Wanjiru" (Title-case proper noun) is redacted (Bug 2 fix).
 */
const KINSHIP_NAME_RE =
  /\b(mama|baba|mtoto|dada|ndugu|shangazi|mjomba|nyanya|babu)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/gi;

/**
 * M-Pesa transaction codes: 10 alphanumeric chars, 2-3 leading uppercase
 * letters then 7-8 more uppercase alphanumerics — e.g. "QGR4H9X7ZP",
 * "SI9K2M4N1P". Real codes interleave letters and digits; the original
 * regex `/\b([A-Z]{2}\d{4}[A-Z0-9]{4})\b/g` demanded exactly 4 digits at
 * positions 3-6, so neither spec example matched (positions 3-6 of
 * "QGR4H9X7ZP" are "R4H9" — not all digits) — payment refs leaked to Qwen
 * (Bug 1 fix). The post-filter (≥1 digit) prevents redacting all-caps
 * English words like "WASHINGTON".
 */
const MPESA_CODE_RE = /\b([A-Z]{2,3}[A-Z0-9]{7,8})\b/g;

/**
 * Plot/house-number patterns common in Kenyan addresses:
 *  - "Plot 123", "House No. 45", "PLOT 67 Mandazi"
 *  - "plot 12, Kwa Njenga" — we redact just the plot number token, keep the
 *    area name (area names are coarse enough not to identify a household, and
 *    triage context like "Kibra" matters).
 */
const PLOT_RE = /\b(plot|house\s*no\.?|door\s*no\.?|apt\.?)\s*#?\s*(\d+[A-Za-z]?)\b/gi;

/**
 * Kenyan vehicle number plates: "KXX 1234" (old) or "KXX 1234A" (new — 4
 * digits + trailing letter suffix, e.g. "KDA 1234A"). Also catches the
 * no-space variant. The original regex `/\bK[A-Z]{2}\s?\d{3}[A-Z]?\d?\b/g`
 * greedily consumed the 4th digit then failed `\b` against a trailing letter,
 * so new-format "KDA 1234A" leaked — fix is `\d{3,4}[A-Z]?` (Bug 4 fix).
 */
const PLATE_RE = /\bK[A-Z]{2}\s?\d{3,4}[A-Z]?\b/g;

/**
 * School names common in CHV observations when describing a child's context:
 *  - "anashinda Shule ya Msingi Mwangaza", "anafanya St. Mary's Primary"
 *  - "Mwalimu wa Acacia Academy alisema..."
 * We redact the proper-noun school name following "shule"/"school"/"academy"/
 * "primary"/"secondary"/"msingi", keeping the context keyword and the Swahili
 * linkword "ya". Conservative — only triggers when a clear institution keyword
 * precedes a capitalized name.
 *
 * The `i` flag is kept so "shule"/"Shule"/"SHULE" all trigger the keyword
 * match, but the captured "name" is re-validated case-sensitively via
 * `SCHOOL_NAME_RE` (Bug 2 fix). The "ya" linkword is captured WITHOUT the
 * surrounding whitespace — the original `(ya\s+)?` capture consumed the
 * trailing space, and combined with the `\s+` between the keyword and `ya`
 * the replacement produced "Shuleya [SCHOOL]" with no space. The new
 * replacement `${kw}${ya ? " " + ya : ""} [SCHOOL]` re-inserts a single
 * space (Bug 3 fix).
 */
const SCHOOL_RE =
  /\b(shule|school|academy|primary|secondary|msingi)\s+(ya)?\s*([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{1,}){0,3})\b/gi;

export function scrubPII(input: string): ScrubResult {
  let redacted = input;
  const redactionCount = {
    phone: 0,
    email: 0,
    idNumber: 0,
    namePattern: 0,
    mpesaCode: 0,
    plotNumber: 0,
    vehiclePlate: 0,
    schoolName: 0,
  };

  // Phones first (before ID regex catches the digit tail).
  redacted = redacted.replace(PHONE_RE, (match) => {
    redactionCount.phone++;
    return "[PHONE]";
  });

  // Emails.
  redacted = redacted.replace(EMAIL_RE, () => {
    redactionCount.email++;
    return "[EMAIL]";
  });

  // M-Pesa transaction codes (before the ID regex catches the digit tail).
  redacted = redacted.replace(MPESA_CODE_RE, (match) => {
    // Post-filter (Bug 1): require ≥1 digit so all-caps English words like
    // "WASHINGTON" are NOT redacted. The regex alone would catch any 9-11
    // char uppercase-alnum token, so this digit gate keeps ordinary
    // all-caps English intact.
    if (!/\d/.test(match)) return match;
    redactionCount.mpesaCode++;
    return "[MPESA]";
  });

  // Vehicle plates (before the ID regex catches the digit tail).
  redacted = redacted.replace(PLATE_RE, () => {
    redactionCount.vehiclePlate++;
    return "[PLATE]";
  });

  // Plot / house numbers.
  redacted = redacted.replace(PLOT_RE, (match, prefix: string, _num: string) => {
    redactionCount.plotNumber++;
    return `${prefix} [PLOT]`;
  });

  // School names (before the kinship regex could catch a following name).
  redacted = redacted.replace(
    SCHOOL_RE,
    (match, kw: string, ya: string | undefined, name: string) => {
      // Case-sensitive prefix extraction (Bug 2): see KINSHIP_NAME_RE callback
      // — the `i` flag on SCHOOL_RE greedily extends the captured `name` to
      // include trailing lowercase verbs (e.g. "Academy Acacia alisema"
      // captures name="Acacia alisema"). We re-match just the Title-case prefix
      // and leave the verb intact. If no Title-case prefix exists (e.g.
      // "shule anasema" — captured name="anasema"), the whole match is left
      // unchanged.
      const prefix = name.match(SCHOOL_NAME_RE)?.[0];
      if (!prefix) return match;
      redactionCount.schoolName++;
      // Bug 3 fix: re-insert a single space between the keyword and the "ya"
      // linkword (when present) — the original "(ya\s+)? + \s+" combo
      // produced "Shuleya [SCHOOL]" with the space swallowed.
      return `${kw}${ya ? " " + ya : ""} [SCHOOL]${name.slice(prefix.length)}`;
    }
  );

  // National-ID-like digit runs (7-9 digits).
  redacted = redacted.replace(ID_RE, (match) => {
    redactionCount.idNumber++;
    return "[ID]";
  });

  // Kinship + name patterns.
  redacted = redacted.replace(
    KINSHIP_NAME_RE,
    (match, kinship: string, name: string) => {
      // Case-sensitive prefix extraction (Bug 2): the `i` flag on
      // KINSHIP_NAME_RE greedily extends the captured `name` to include a
      // trailing lowercase Swahili verb (e.g. "mama Wanjiru anasema" captures
      // name="Wanjiru anasema"). We re-match just the Title-case PREFIX of
      // the captured `name` here and leave the verb intact. If no Title-case
      // prefix exists (e.g. "mama anasema" — captured name="anasema"), the
      // whole match is left unchanged.
      const prefix = name.match(PROPER_NAME_RE)?.[0];
      if (!prefix) return match;
      redactionCount.namePattern++;
      return `${kinship} [NAME]${name.slice(prefix.length)}`;
    }
  );

  const hadRedactions =
    redactionCount.phone +
      redactionCount.email +
      redactionCount.idNumber +
      redactionCount.namePattern +
      redactionCount.mpesaCode +
      redactionCount.plotNumber +
      redactionCount.vehiclePlate +
      redactionCount.schoolName >
    0;

  return { redacted, redactionCount, hadRedactions };
}

/**
 * Subset of `scrubPII` for use on follow-up resolution notes — runs phones,
 * emails, kinship names, M-Pesa codes, vehicle plates, plot numbers, and
 * school names — but NOT the 7-9 digit ID redaction. Follow-up notes may
 * legitimately contain ages (e.g. "mtoto wa miaka 5"), bed-net counts,
 * household sizes, or other 7-9 digit numbers that are NOT national IDs, so
 * the ID_RE pass is intentionally skipped here. Returns only the redacted
 * text (no counts needed for the follow-up caller).
 *
 * Mirrors the regex order in `scrubPII` (minus the ID pass).
 */
export function scrubNote(text: string): string {
  let redacted = text;

  redacted = redacted.replace(PHONE_RE, "[PHONE]");
  redacted = redacted.replace(EMAIL_RE, "[EMAIL]");

  // M-Pesa with the same ≥1 digit post-filter as scrubPII.
  redacted = redacted.replace(MPESA_CODE_RE, (match) =>
    /\d/.test(match) ? "[MPESA]" : match
  );

  redacted = redacted.replace(PLATE_RE, "[PLATE]");

  redacted = redacted.replace(
    PLOT_RE,
    (_match, prefix: string, _num: string) => `${prefix} [PLOT]`
  );

  // School — same case-sensitive prefix extraction + space-fixed
  // replacement as `scrubPII` (Bug 2 + Bug 3 fixes).
  redacted = redacted.replace(
    SCHOOL_RE,
    (match, kw: string, ya: string | undefined, name: string) => {
      const prefix = name.match(SCHOOL_NAME_RE)?.[0];
      if (!prefix) return match;
      return `${kw}${ya ? " " + ya : ""} [SCHOOL]${name.slice(prefix.length)}`;
    }
  );

  // Kinship — same case-sensitive prefix extraction + leftover-preserve
  // logic as `scrubPII` (Bug 2 fix).
  redacted = redacted.replace(
    KINSHIP_NAME_RE,
    (match, kinship: string, name: string) => {
      const prefix = name.match(PROPER_NAME_RE)?.[0];
      if (!prefix) return match;
      return `${kinship} [NAME]${name.slice(prefix.length)}`;
    }
  );

  return redacted;
}
