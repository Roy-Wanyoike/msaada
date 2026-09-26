import { parseJsonObject, qwenChat, qwenConfigured } from "@/lib/ai/client";

/**
 * Second-pass de-identification with Qwen, for free text that gets STORED
 * (public report descriptions, case and follow-up resolution notes).
 *
 * Runs AFTER the deterministic regex scrubber (pii-scrub.ts), on its output,
 * so Qwen only ever sees text that is already partly redacted. Qwen returns
 * the identifiers it finds; this code does the replacement, and only for
 * spans that literally occur in the text, so the model can't rewrite or add
 * content. Any failure returns the regex-scrubbed text unchanged.
 */

export const PRIVACY_PROMPT_VERSION = "privacy-scan-v1";

const SYSTEM_PROMPT = `You find personal identifiers in short Kenyan community-health notes (Kiswahili, Sheng, English or mixed). Text in square brackets like [NAME] or [PHONE] is already redacted; ignore it.

Flag ONLY things that could identify a specific person or household:
- personal names and nicknames (e.g. "Wanjiru", "Baba Otieno", "Kevo")
- exact home locations (house/plot numbers, "the blue gate next to X's shop")
- names of specific schools, churches, employers or businesses tied to the person
- ID, phone or account numbers

Do NOT flag: county, sub-county, ward or town names; kinship words (mama, baba, mtoto, kijana, bibi, shangazi); ages; symptoms; generic places (market, river, school, dispensary).

Respond with a single JSON object only, copying each identifier exactly as written:
{"identifiers": [{"text": "exact substring", "type": "name" | "place" | "organisation" | "number"}]}
Use an empty list if there are none.`;

const PLACEHOLDER: Record<string, string> = {
  name: "[NAME]",
  place: "[PLACE]",
  organisation: "[ORG]",
  number: "[ID]",
};

/** Words the model must not redact even if it flags them. */
const NEVER_REDACT = new Set([
  "mama", "baba", "mtoto", "watoto", "kijana", "bibi", "babu", "shangazi",
  "mjomba", "dada", "kaka", "mzee", "chv", "kilifi", "mombasa", "nairobi",
  "turkana", "kisumu",
]);

export interface PrivacyScanResult {
  text: string;
  /** How many spans Qwen redacted (0 on skip/failure). */
  redactions: number;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function privacyScan(scrubbedText: string): Promise<PrivacyScanResult> {
  const unchanged = { text: scrubbedText, redactions: 0 };
  if (!qwenConfigured() || scrubbedText.trim().length < 3) return unchanged;

  try {
    const { content } = await qwenChat({
      task: "privacy_scan",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: scrubbedText },
      ],
      json: true,
      temperature: 0,
      maxTokens: 400,
      timeoutMs: 10_000,
    });
    const found = parseJsonObject(content)?.identifiers;
    if (!Array.isArray(found)) return unchanged;

    let text = scrubbedText;
    let redactions = 0;
    // Longest first, so "Baba Otieno" is replaced before "Otieno".
    const spans = found
      .filter(
        (f): f is { text: string; type?: string } =>
          !!f && typeof f === "object" && typeof (f as { text?: unknown }).text === "string"
      )
      .map((f) => ({ text: f.text.trim(), type: f.type ?? "name" }))
      .filter((f) => f.text.length >= 2 && !f.text.includes("[") && !NEVER_REDACT.has(f.text.toLowerCase()))
      .sort((a, b) => b.text.length - a.text.length);

    for (const span of spans) {
      const re = new RegExp(escapeRegExp(span.text), "g");
      const next = text.replace(re, PLACEHOLDER[span.type] ?? "[REDACTED]");
      if (next !== text) {
        redactions++;
        text = next;
      }
    }
    return { text, redactions };
  } catch (err) {
    console.error(
      "[qwen] privacy scan failed, keeping regex-scrubbed text:",
      err instanceof Error ? err.message : err
    );
    return unchanged;
  }
}
