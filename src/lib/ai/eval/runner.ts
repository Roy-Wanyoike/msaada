import type { QwenAttempt } from "@/lib/ai/client";
import {
  deriveMissingInformation,
  resolveMissingInformation,
  type QwenCallResult,
} from "@/lib/ai/triage";
import {
  EVAL_FIXTURES,
  type EvalFixture,
  type EvalExpectedClassification,
} from "./fixtures";

/**
 * Triage evaluation runner (issue #55).
 *
 * Pure-function style: no globals, no DB, no I/O — the caller injects a
 * `classify(text)` function, so the SAME runner scores
 *  - the live path:   `classifyObservation` (Qwen + failover chain), and
 *  - the baseline:    `fallbackTriage` (the deterministic no-key path).
 *
 * Metrics per fixture: classification accuracy, indicator overlap (simple
 * normalized set overlap), missing-information recall, JSON validity (did
 * the path produce a parsed structured verdict), latency ms, fallback
 * share — plus per-model attempt telemetry (the client logs the model per
 * attempt; we reuse the chainAttempts it exposes).
 */

// ---- Normalization (lexical, deterministic) --------------------------------

/** Lowercase, trim, collapse whitespace, strip trailing punctuation. */
function normPhrase(s: string): string {
  return s.toLowerCase().trim().replace(/[.!?]+$/u, "").replace(/\s+/gu, " ");
}

/** |gold ∩ actual| / |gold| over normalized phrases. 1.0 for empty gold. */
function setOverlapRecall(gold: string[], actual: string[]): number {
  if (gold.length === 0) return 1;
  const actualSet = new Set(actual.map(normPhrase));
  const hit = gold.filter((g) => actualSet.has(normPhrase(g))).length;
  return hit / gold.length;
}

// ---- Types -----------------------------------------------------------------

export interface EvalFixtureResult {
  id: string;
  language: string;
  expectedClassification: EvalExpectedClassification;
  actualClassification: EvalExpectedClassification;
  classificationCorrect: boolean;
  /** |gold ∩ actual| / |gold|; null when the fixture has no indicator gold. */
  indicatorRecall: number | null;
  /** |gold ∩ actual| / |gold|; null for routine fixtures (no missing-info gold). */
  missingInfoRecall: number | null;
  /** True when the pipeline produced a parsed structured verdict (not raw). */
  jsonValid: boolean;
  latencyMs: number;
  fallbackUsed: boolean;
  /** Model that produced the verdict ("fallback" on the deterministic path). */
  model: string;
  /** Per-attempt chain telemetry (empty on the deterministic path). */
  attempts: QwenAttempt[];
}

export interface EvalModelStat {
  model: string;
  /** API calls actually made by this model (attempts, not fixtures). */
  attempts: number;
  ok: number;
  failed: number;
  avgLatencyMs: number | null;
  /** Fixtures whose FINAL verdict came from this model. */
  verdicts: number;
  errorKinds: Record<string, number>;
}

export interface EvalScorecard {
  label: string;
  fixtureCount: number;
  /** Share of fixtures whose classification matched gold. */
  classificationAccuracy: number;
  /** Mean indicator overlap over fixtures WITH indicator gold. */
  indicatorRecall: number | null;
  /** Mean missing-info recall over fixtures WITH missing-info gold. */
  missingInfoRecall: number | null;
  /** Share of fixtures whose structured JSON parsed. */
  jsonValidity: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  /** Share of fixtures served by the deterministic fallback. */
  fallbackShare: number;
  /** Per-model attempt/verdict telemetry. */
  byModel: EvalModelStat[];
  fixtures: EvalFixtureResult[];
}

// ---- Core ------------------------------------------------------------------

/** Map a pipeline verdict to the eval's expected-classification space. */
function actualClassificationOf(result: QwenCallResult): EvalExpectedClassification {
  return result.output.escalation === true ? "crisis_override" : result.output.classification;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function aggregate(
  label: string,
  results: EvalFixtureResult[]
): EvalScorecard {
  const n = results.length;
  const correct = results.filter((r) => r.classificationCorrect).length;
  const withIndicators = results.filter((r) => r.indicatorRecall !== null);
  const withMissing = results.filter((r) => r.missingInfoRecall !== null);
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const fallbackCount = results.filter((r) => r.fallbackUsed).length;
  const jsonValidCount = results.filter((r) => r.jsonValid).length;

  // Per-model telemetry: one row per model ATTEMPTED (ok or failed).
  const byModel = new Map<string, EvalModelStat & { latencies: number[] }>();
  const track = (model: string): EvalModelStat & { latencies: number[] } => {
    let m = byModel.get(model);
    if (!m) {
      m = {
        model,
        attempts: 0,
        ok: 0,
        failed: 0,
        avgLatencyMs: null,
        verdicts: 0,
        errorKinds: {},
        latencies: [],
      };
      byModel.set(model, m);
    }
    return m;
  };
  for (const r of results) {
    if (r.attempts.length === 0) {
      // Deterministic path: one pseudo-attribution so the baseline is
      // visible in the table instead of silently missing.
      track(r.model).verdicts += 1;
      continue;
    }
    for (const a of r.attempts) {
      const m = track(a.model);
      m.attempts += 1;
      if (a.ok) {
        m.ok += 1;
        m.latencies.push(a.latencyMs);
      } else {
        m.failed += 1;
        if (a.errorKind) m.errorKinds[a.errorKind] = (m.errorKinds[a.errorKind] ?? 0) + 1;
      }
    }
    track(r.model).verdicts += 1;
  }

  return {
    label,
    fixtureCount: n,
    classificationAccuracy: n ? correct / n : 0,
    indicatorRecall:
      withIndicators.length > 0
        ? withIndicators.reduce((s, r) => s + (r.indicatorRecall ?? 0), 0) /
          withIndicators.length
        : null,
    missingInfoRecall:
      withMissing.length > 0
        ? withMissing.reduce((s, r) => s + (r.missingInfoRecall ?? 0), 0) /
          withMissing.length
        : null,
    jsonValidity: n ? jsonValidCount / n : 0,
    avgLatencyMs: n ? latencies.reduce((s, l) => s + l, 0) / n : 0,
    p95LatencyMs: percentile(latencies, 95),
    fallbackShare: n ? fallbackCount / n : 0,
    byModel: [...byModel.values()].map(({ latencies: ls, ...m }) => ({
      ...m,
      avgLatencyMs: ls.length
        ? Math.round(ls.reduce((s, l) => s + l, 0) / ls.length)
        : null,
    })),
    fixtures: results,
  };
}

export interface RunEvalOptions {
  /** The triage path under test: text → QwenCallResult. */
  classify: (text: string) => Promise<QwenCallResult>;
  /** Fixture subset (defaults to all EVAL_FIXTURES). */
  fixtures?: EvalFixture[];
  /** Scorecard label, e.g. "live-qwen" | "deterministic-baseline". */
  label: string;
}

/** Run the fixtures through `classify` and score them. Pure — no globals. */
export async function runTriageEval(
  opts: RunEvalOptions
): Promise<EvalScorecard> {
  const fixtures = opts.fixtures ?? EVAL_FIXTURES;
  const results: EvalFixtureResult[] = [];

  for (const f of fixtures) {
    const started = Date.now();
    let result: QwenCallResult;
    try {
      result = await opts.classify(f.text);
    } catch {
      // A classify() that throws counts as a fallback-shaped failure —
      // the eval must never crash on one bad fixture.
      result = {
        output: {
          escalation: false,
          classification: "needs_followup",
          observed_indicators: [],
          missing_information: [],
          chp_next_action: "",
          confidence_note: "eval runner: classify threw",
          aggregate_tag: "eval_error",
        },
        fallbackUsed: true,
        attempts: 0,
        model: "fallback",
        promptVersion: "eval-runner",
      };
    }
    const latencyMs = Date.now() - started;

    const actual = actualClassificationOf(result);
    const isFallback = result.fallbackUsed;
    const output = result.output;
    const actualIndicators =
      output.escalation === true ? [] : output.observed_indicators;
    // Mirror the shipped /api/triage route (step 4b): the persisted
    // missing-information list is ALWAYS resolved — crisis → the crisis
    // trio, normal → the model's list when non-empty, else the derived
    // per-classification list. Scoring anything less would under-report
    // the deterministic path, which never persists a bare CrisisResult.
    const actualMissing =
      output.escalation === true
        ? deriveMissingInformation("crisis_override")
        : resolveMissingInformation(output);

    results.push({
      id: f.id,
      language: f.language,
      expectedClassification: f.expected.classification,
      actualClassification: actual,
      classificationCorrect: actual === f.expected.classification,
      indicatorRecall:
        f.expected.indicators.length > 0
          ? setOverlapRecall(f.expected.indicators, actualIndicators)
          : null,
      missingInfoRecall:
        f.expected.missingInformation.length > 0
          ? setOverlapRecall(f.expected.missingInformation, actualMissing)
          : null,
      // JSON validity: the live path's fallbackUsed means the model reply
      // could not be parsed into the contract; the deterministic path has
      // no JSON boundary at all (vacuously valid).
      jsonValid: !isFallback,
      latencyMs,
      fallbackUsed: isFallback,
      model: result.model,
      attempts: result.chainAttempts ?? [],
    });
  }

  return aggregate(opts.label, results);
}
