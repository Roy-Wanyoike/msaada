/**
 * Labeled synthetic evaluation fixtures (issue #55).
 *
 * ~15 short observations across English / Kiswahili / Sheng / code-switched
 * speech — the four language registers Msaada's CHVs actually use. Every
 * string here is authored for this file (synthetic by construction): no
 * real persons, no scraped text, no PII — kinship labels + coarse
 * situations only, matching the repo's de-identification conventions.
 *
 * Gold labels:
 *  - classification: the verdict a correct triage must produce. The four
 *    workflow classes are used, with "crisis_override" for escalations
 *    (the classification the policy engine records for escalation=true).
 *  - indicators: key behavioural indicators a good structured answer
 *    should surface. Scored by simple set overlap (lexical, normalized) —
 *    phrase the gold labels the way the model is prompted to speak
 *    (behaviours, never clinical labels).
 *  - missingInformation: gold missing-info items. Non-routine fixtures
 *    carry exactly 2, chosen to match the deterministic derivation table
 *    (deriveMissingInformation) so the no-key baseline is measurable.
 *    Routine fixtures carry [] BY CONTRACT: the product's routine mapping
 *    is "nothing needs asking" (routine → []), so a routine gold list
 *    would be unproducible by ANY path and would poison the metric with a
 *    constant zero. The recall aggregate therefore averages only over the
 *    11 gold-bearing fixtures.
 */

export type EvalLanguage = "en" | "sw" | "sheng" | "mixed";

export type EvalExpectedClassification =
  | "routine"
  | "needs_followup"
  | "needs_facility_referral"
  | "crisis_override";

export interface EvalFixture {
  id: string;
  language: EvalLanguage;
  /** Synthetic observation text (never persisted, never sent anywhere). */
  text: string;
  expected: {
    classification: EvalExpectedClassification;
    indicators: string[];
    /** Gold missing-info items; [] for routine (see module doc). */
    missingInformation: string[];
  };
}

export const EVAL_FIXTURES: EvalFixture[] = [
  // ---- English ------------------------------------------------------------
  {
    id: "en-routine-market",
    language: "en",
    text:
      "Morning visit: mama is sleeping well through the night, eating three " +
      "meals a day, joking with the neighbours and back at her market stall. " +
      "No complaints today.",
    expected: {
      classification: "routine",
      indicators: ["sleeping well", "appetite normal", "mood stable"],
      missingInformation: [],
    },
  },
  {
    id: "en-followup-withdrawal",
    language: "en",
    text:
      "Bibi has hardly left her room for two weeks. She is not sleeping at " +
      "night, barely touches her food, and stopped coming to the sewing " +
      "group she loves.",
    expected: {
      classification: "needs_followup",
      indicators: ["social withdrawal", "insomnia", "poor appetite"],
      missingInformation: ["symptom duration", "sleep/appetite change"],
    },
  },
  {
    id: "en-referral-functional",
    language: "en",
    text:
      "Baba has not slept in three days, cries without explanation through " +
      "the day, has stopped eating entirely and can no longer manage his " +
      "washing or dressing on his own.",
    expected: {
      classification: "needs_facility_referral",
      indicators: [
        "severe insomnia",
        "frequent crying",
        "appetite loss",
        "impaired daily functioning",
      ],
      missingInformation: ["symptom duration", "severity progression"],
    },
  },
  {
    id: "en-crisis-ideation",
    language: "en",
    text:
      "The teenage boy told his uncle he has been thinking about suicide and " +
      "says he has a plan to end his life this weekend.",
    expected: {
      classification: "crisis_override",
      indicators: ["expressed suicidal ideation", "stated plan"],
      missingInformation: ["confirm immediate safety", "exact location"],
    },
  },
  {
    id: "en-routine-elderly",
    language: "en",
    text:
      "Home visit to the elderly baba: he is steady on his feet, sleeps " +
      "well, shares meals with the family and tends his cattle as usual. " +
      "The family reports no changes.",
    expected: {
      classification: "routine",
      indicators: ["sleeping well", "appetite normal", "mobility stable"],
      missingInformation: [],
    },
  },

  // ---- Kiswahili ------------------------------------------------------------
  {
    id: "sw-followup-kutokea",
    language: "sw",
    text:
      "Kaka anatumia siku nzima chini ya kitandani, hakulali usiku, hana " +
      "hamu ya chakula, na ameacha kuhudhuria ibada kama kawaida.",
    expected: {
      classification: "needs_followup",
      indicators: ["insomnia", "poor appetite", "social withdrawal"],
      missingInformation: ["symptom duration", "sleep/appetite change"],
    },
  },
  {
    id: "sw-crisis-kujiua",
    language: "sw",
    text:
      "Amewaambia jirani kuwa anataka kujiua na amekuwa akizungumza kuwa " +
      "maisha hayana maana.",
    expected: {
      classification: "crisis_override",
      indicators: ["expressed intent to self-harm", "hopelessness"],
      missingInformation: ["confirm immediate safety", "exact location"],
    },
  },
  {
    id: "sw-routine-vizuri",
    language: "sw",
    text:
      "Mama anaendelea vizuri, analala vizuri, anakula vizuri, na anafanya " +
      "kazi zake za kila siku bila shida.",
    expected: {
      classification: "routine",
      indicators: ["sleeping well", "appetite normal", "functioning well"],
      missingInformation: [],
    },
  },
  {
    id: "sw-referral-kutotunza",
    language: "sw",
    text:
      "Bibi hakulali kabisa siku tatu, analia bila sababu, hali amekata " +
      "kula, na hawezi kujitunza yeye mwenyewe.",
    expected: {
      classification: "needs_facility_referral",
      indicators: ["severe insomnia", "frequent crying", "appetite loss", "unable to self-care"],
      missingInformation: ["symptom duration", "severity progression"],
    },
  },

  // ---- Sheng ----------------------------------------------------------------
  {
    id: "sheng-followup-mabeshte",
    language: "sheng",
    text:
      "Mboy ako na usingizi mbaya sana, hakuli vizuri, na imewachana na " +
      "mabeshte yote — ile vibes ya kawaida imepotea.",
    expected: {
      classification: "needs_followup",
      indicators: ["insomnia", "poor appetite", "social withdrawal"],
      missingInformation: ["symptom duration", "sleep/appetite change"],
    },
  },
  {
    id: "sheng-crisi-kufa",
    language: "sheng",
    text:
      "Kijana wa kando amewaambia mabeshte anataka kufa, ameshasema maisha " +
      "hayana maana, na wasee wako na hofu atajidhuru leo usiku.",
    expected: {
      classification: "crisis_override",
      indicators: ["expressed intent to self-harm", "hopelessness"],
      missingInformation: ["confirm immediate safety", "exact location"],
    },
  },
  {
    id: "sheng-routine-poa",
    language: "sheng",
    text:
      "Mresh ako poa leo — analala vizuri, anakula vizuri, na anasema hana " +
      "stress yoyote.",
    expected: {
      classification: "routine",
      indicators: ["sleeping well", "appetite normal", "no distress"],
      missingInformation: [],
    },
  },

  // ---- Code-switched (English + Kiswahili) -----------------------------------
  {
    id: "mixed-referral-usingizi",
    language: "mixed",
    text:
      "Mama says she cannot sleep at all — siku tatu zima usingizi hakuna — " +
      "and she has stopped eating kabisa. Jirani amesema analia usiku kucha.",
    expected: {
      classification: "needs_facility_referral",
      indicators: ["severe insomnia", "appetite loss", "frequent crying"],
      missingInformation: ["symptom duration", "severity progression"],
    },
  },
  {
    id: "mixed-followup-shule",
    language: "mixed",
    text:
      "Mtoto anarudi school lakini mwalimu says he sleeps in class, hana " +
      "hamu ya chakula, and he no longer plays with the other kids.",
    expected: {
      classification: "needs_followup",
      indicators: ["insomnia", "poor appetite", "social withdrawal"],
      missingInformation: ["symptom duration", "sleep/appetite change"],
    },
  },
  {
    id: "mixed-crisi-dawa",
    language: "mixed",
    text:
      "Baba amesema \"I want to end my life\" na ameficha dawa nyingi chini " +
      "ya kitanda — the family found a rope pia.",
    expected: {
      classification: "crisis_override",
      indicators: ["expressed suicidal ideation", "means mentioned"],
      missingInformation: ["confirm immediate safety", "exact location"],
    },
  },
];

/** Fixture count by language (sanity: 5 en / 4 sw / 3 sheng / 3 mixed = 15). */
export const EVAL_FIXTURE_COUNT = EVAL_FIXTURES.length;
