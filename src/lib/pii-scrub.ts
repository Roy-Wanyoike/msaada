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
 * Name patterns common in CHV observations:
 *  - "mama Wanjiru", "baba Kamau", "mtoto Amani" (Swahili kinship + name)
 *  - "Mama A", "Baba B" (single-letter placeholder — keep as-is, already de-id'd)
 * We redact a proper-name following mama/baba/mtoto/dada/ndugu, but NOT a
 * single capital letter (those are already placeholders).
 */
const KINSHIP_NAME_RE =
  /\b(mama|baba|mtoto|dada|ndugu|shangazi|mjomba|nyanya|babu)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/gi;

/**
 * M-Pesa transaction codes: 10 alphanumeric chars, uppercase, starting with a
 * letter — e.g. "QGR4H9X7ZP", "SI9K2M4N1P". Redact so a CHV doesn't leak a
 * payment reference (common in Kenya when describing household circumstances).
 */
const MPESA_CODE_RE = /\b([A-Z]{2}\d{4}[A-Z0-9]{4})\b/g;

/**
 * Plot/house-number patterns common in Kenyan addresses:
 *  - "Plot 123", "House No. 45", "PLOT 67 Mandazi"
 *  - "plot 12, Kwa Njenga" — we redact just the plot number token, keep the
 *    area name (area names are coarse enough not to identify a household, and
 *    triage context like "Kibra" matters).
 */
const PLOT_RE = /\b(plot|house\s*no\.?|door\s*no\.?|apt\.?)\s*#?\s*(\d+[A-Za-z]?)\b/gi;

export function scrubPII(input: string): ScrubResult {
  let redacted = input;
  const redactionCount = {
    phone: 0,
    email: 0,
    idNumber: 0,
    namePattern: 0,
    mpesaCode: 0,
    plotNumber: 0,
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
  redacted = redacted.replace(MPESA_CODE_RE, () => {
    redactionCount.mpesaCode++;
    return "[MPESA]";
  });

  // Plot / house numbers.
  redacted = redacted.replace(PLOT_RE, (match, prefix: string, _num: string) => {
    redactionCount.plotNumber++;
    return `${prefix} [PLOT]`;
  });

  // National-ID-like digit runs (7-9 digits).
  redacted = redacted.replace(ID_RE, (match) => {
    redactionCount.idNumber++;
    return "[ID]";
  });

  // Kinship + name patterns.
  redacted = redacted.replace(
    KINSHIP_NAME_RE,
    (match, kinship: string, _name: string) => {
      redactionCount.namePattern++;
      return `${kinship} [NAME]`;
    }
  );

  const hadRedactions =
    redactionCount.phone +
      redactionCount.email +
      redactionCount.idNumber +
      redactionCount.namePattern +
      redactionCount.mpesaCode +
      redactionCount.plotNumber >
    0;

  return { redacted, redactionCount, hadRedactions };
}
