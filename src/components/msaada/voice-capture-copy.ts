/**
 * Copy deck + missing-information heuristics for the voice-first encounter
 * capture sheet (MVP-46).
 *
 * Everything user-facing lives here so the component stays a pure state
 * machine. Kiswahili strings are operational-register, matching the bilingual
 * voice of the live Qwen pipeline (chpNextActionSw).
 *
 * The missing-info bank is a FRONTEND heuristic by design: there is no
 * pre-save missing-info endpoint (the existing suggestions API needs a
 * persisted FollowUp id), so the sheet suggests follow-up questions from the
 * returned classification/aggregateTag — never inventing an API.
 */

import type { TriageRecordDTO } from "@/lib/types";

/** Staged progress copy shown during POST /api/triage (no progress events —
 *  timed on the client against real latencies: p50 ≈ 8s, worst ≈ 30s). */
export const STAGE_COPY = {
  transcribing: {
    en: "Transcribing your voice note…",
    sw: "Tunabadilisha sauti kuwa maandishi…",
  },
  extract: {
    en: "Extracting observations — sleep, appetite, withdrawal…",
    sw: "Tunatoa dalili — usingizi, hamu ya kula, kujitenga…",
  },
  safety: {
    en: "Checking safety rules…",
    sw: "Tunakagua sheria za usalama…",
  },
  slow: {
    en: "Still working — complex observations can take up to 30 seconds.",
    sw: "Bado tunaendelea — uchambuzi unaweza kuchukua sekunde 30.",
  },
} as const;

export interface MissingInfoItem {
  sw: string;
  en: string;
}

interface MissingInfoMatcher {
  test: (record: TriageRecordDTO) => boolean;
  items: MissingInfoItem[];
}

/** Ordered bank — first matches win, capped at 4 items by the caller. */
const MISSING_INFO_BANK: MissingInfoMatcher[] = [
  {
    // Safety first: anything heading to a facility gets the safety question.
    test: (r) => r.classification === "needs_facility_referral",
    items: [
      { sw: "Je, yuko salama saivi?", en: "Is he or she safe right now?" },
    ],
  },
  {
    // Fallback: the model could not parse — gather more to help the next try.
    test: (r) => r.fallbackUsed,
    items: [
      {
        sw: "Ungesema zaidi kuhusu tabia ulizoziona?",
        en: "Can you add more about the behaviours you saw?",
      },
    ],
  },
  {
    test: (r) => (r.aggregateTag ?? "").includes("sleep"),
    items: [
      {
        sw: "Anaamka mara ngapi usiku?",
        en: "How often does he or she wake at night?",
      },
      {
        sw: "Amelala zaidi mchana?",
        en: "Sleeping more during the day?",
      },
    ],
  },
  {
    test: (r) =>
      (r.aggregateTag ?? "").includes("school") ||
      (r.aggregateTag ?? "").includes("shule"),
    items: [
      {
        sw: "Amekosa shule siku ngapi wiki hii?",
        en: "How many school days were missed this week?",
      },
    ],
  },
  {
    test: (r) =>
      (r.aggregateTag ?? "").includes("withdraw") ||
      (r.aggregateTag ?? "").includes("social"),
    items: [
      {
        sw: "Anacheza au kuongea na wengine?",
        en: "Does he or she play or talk with others?",
      },
    ],
  },
  {
    test: (r) =>
      (r.aggregateTag ?? "").includes("eat") ||
      (r.aggregateTag ?? "").includes("appetite"),
    items: [
      {
        sw: "Kuna mabadiliko ya uzito?",
        en: "Any weight changes you noticed?",
      },
    ],
  },
  {
    test: (r) =>
      (r.aggregateTag ?? "").includes("hasira") ||
      (r.aggregateTag ?? "").includes("aggress"),
    items: [
      {
        sw: "Hasira zinaanzishwa na nini?",
        en: "What seems to set off the anger?",
      },
    ],
  },
  {
    // Default: the three core wellbeing questions.
    test: () => true,
    items: [
      {
        sw: "Amelala vizuri usiku kwa wiki hii?",
        en: "Has he or she slept well at night this week?",
      },
      {
        sw: "Anakula chakula kama kawaida?",
        en: "Is she or he eating as usual?",
      },
      {
        sw: "Kuna mtu anamsaidia nyumbani?",
        en: "Is anyone at home supporting him or her?",
      },
    ],
  },
];

/** Pick up to `max` missing-information questions for a triage result. */
export function missingInfoFor(
  record: TriageRecordDTO,
  max = 4
): MissingInfoItem[] {
  const items: MissingInfoItem[] = [];
  for (const matcher of MISSING_INFO_BANK) {
    if (matcher.test(record)) {
      for (const item of matcher.items) {
        if (items.length < max) items.push(item);
      }
    }
    if (items.length >= max) break;
  }
  return items.slice(0, max);
}
