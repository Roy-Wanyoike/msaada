"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * AI evaluation panel (issue #55) — compact scorecard next to the
 * "Qwen at work" meter on the dashboard. Reads GET /api/ai/eval:
 *  - deterministicBaseline ALWAYS present (no key needed) — it scores the
 *    deterministic fallback path so the metric shape is demonstrable today;
 *  - live scores appear only when QWEN_API_KEY is configured, otherwise a
 *    graceful "not configured" notice is shown.
 *
 * Metrics shown: classification accuracy, indicator overlap, missing-info
 * recall, JSON validity, average latency, fallback share. This panel does
 * not modify the existing meter's metrics.
 */

interface Scorecard {
  label: string;
  fixtureCount: number;
  classificationAccuracy: number;
  indicatorRecall: number | null;
  missingInfoRecall: number | null;
  jsonValidity: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  fallbackShare: number;
}

interface EvalResponse {
  configured: boolean;
  message?: string;
  fixtureCount?: number;
  live?: Scorecard | null;
  deterministicBaseline: Scorecard;
}

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;

const METRIC_COLUMNS: { key: string; label: string; get: (s: Scorecard) => string }[] = [
  { key: "cls", label: "Classification", get: (s) => pct(s.classificationAccuracy) },
  { key: "ind", label: "Indicators", get: (s) => pct(s.indicatorRecall) },
  { key: "miss", label: "Missing info", get: (s) => pct(s.missingInfoRecall) },
  { key: "json", label: "JSON valid", get: (s) => pct(s.jsonValidity) },
  {
    key: "lat",
    label: "Avg latency",
    get: (s) => (s.avgLatencyMs < 1000 ? `${Math.round(s.avgLatencyMs)}ms` : `${(s.avgLatencyMs / 1000).toFixed(1)}s`),
  },
  { key: "fb", label: "Fallback", get: (s) => pct(s.fallbackShare) },
];

function ScoreRow({ s, tone }: { s: Scorecard; tone: "baseline" | "live" }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_repeat(6,minmax(0,auto))] items-center gap-x-3 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "live" ? "bg-emerald-500" : "bg-muted-foreground/50"
          )}
          aria-hidden
        />
        <span className="truncate" title={s.label}>
          {tone === "live" ? "Live (Qwen)" : "Deterministic baseline"}
        </span>
      </span>
      {METRIC_COLUMNS.map((c) => (
        <span key={c.key} className="shrink-0 text-right tabular-nums text-muted-foreground">
          {c.get(s)}
        </span>
      ))}
    </div>
  );
}

export function AiEvalPanel() {
  const [data, setData] = useState<EvalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/eval", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.status === 401 || res.status === 403) {
        setError("Evaluation is restricted to supervisor-or-above roles.");
        return;
      }
      if (!res.ok) {
        setError(`Evaluation request failed (${res.status}).`);
        return;
      }
      setData((await res.json()) as EvalResponse);
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The baseline run is pure-deterministic (no model, no key) — cheap
    // enough to auto-load so the panel is never empty on open.
    void run();
  }, [run]);

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FlaskConical className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">AI evaluation</p>
            <p className="text-[11px] text-muted-foreground">
              {data?.fixtureCount ?? 15} labeled synthetic fixtures · triage accuracy harness
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 px-3 text-xs"
          onClick={() => void run()}
          disabled={loading}
        >
          {loading ? (
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="size-3.5" aria-hidden />
          )}
          Run evaluation
        </Button>
      </div>

      {/* Metric header */}
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(6,minmax(0,auto))] gap-x-3 px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="px-0">Path</span>
        {METRIC_COLUMNS.map((c) => (
          <span key={c.key} className="shrink-0 text-right">
            {c.label}
          </span>
        ))}
      </div>

      <div className="space-y-1.5 px-2.5 pb-3">
        {data && <ScoreRow s={data.deterministicBaseline} tone="baseline" />}
        {data?.configured && data.live && <ScoreRow s={data.live} tone="live" />}

        {!loading && !error && data && !data.configured && (
          <p className="px-1 pt-1 text-[11px] text-muted-foreground">
            {data.message ??
              "Set QWEN_API_KEY to run evaluation"}{" "}
            — the deterministic baseline above still demonstrates the scorecard.
          </p>
        )}
        {!loading && error && (
          <p className="px-1 pt-1 text-[11px] text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {loading && !data && (
          <p className="px-1 pt-1 text-[11px] text-muted-foreground" aria-busy="true">
            Scoring fixtures…
          </p>
        )}
      </div>

      <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
        Simple set-overlap scoring on labeled synthetic observations (EN /
        Kiswahili / Sheng / code-switched). Evaluation is advisory — the
        deterministic policy engine still owns every routing decision.
      </p>
    </Card>
  );
}
