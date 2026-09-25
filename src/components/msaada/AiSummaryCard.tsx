"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Summary {
  headline: string;
  points: string[];
  watch: string[];
  model: string;
  generatedAt: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: "AI summaries aren't set up on this server yet.",
  NO_DATA: "There's no data in this period to summarise.",
  RATE_LIMITED: "Too many requests. Try again in a minute.",
  UNAUTHORIZED: "Sign in to generate a summary.",
};

/**
 * On-demand AI briefing of the dashboard's aggregate numbers. Generated only
 * when asked (each call costs model tokens); the server caches for 10 min.
 * Keyed by the parent on days + scope so a filter change resets it.
 */
export function AiSummaryCard({ days, scope }: { days: number; scope: "mine" | "all" }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ days: String(days), scope });
      if (refresh) qs.set("refresh", "1");
      const res = await fetch(`/api/dashboard/summary?${qs}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { summary?: Summary; error?: string };
      if (!res.ok || !data.summary) {
        setError((data.error && ERROR_MESSAGES[data.error]) ?? "Couldn't generate a summary. Try again.");
        return;
      }
      setSummary(data.summary);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="gap-0 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-primary">
            <Sparkles className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">AI summary</p>
            <p className="text-xs text-muted-foreground">
              Written from the aggregate numbers on this page. Check against the charts.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => generate(summary !== null)}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : summary ? (
            <RefreshCw className="size-4" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          )}
          {loading ? "Writing…" : summary ? "Regenerate" : "Generate"}
        </Button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {error}
        </p>
      )}

      {summary && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <p className="text-base font-medium text-foreground">{summary.headline}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90">
            {summary.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {summary.watch.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/30">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="size-3.5" aria-hidden />
                Worth a look
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-900 dark:text-amber-100">
                {summary.watch.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {summary.model} · {new Date(summary.generatedAt).toLocaleString()}
          </p>
        </div>
      )}
    </Card>
  );
}
