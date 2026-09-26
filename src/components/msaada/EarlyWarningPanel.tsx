"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { TONE, prettyTag } from "@/components/msaada/dashboard-helpers";

/**
 * EarlyWarningPanel — dashboard widget for the deterministic early-warning
 * signals (MVP-43). Fetches /api/signals on mount and renders one row per
 * signal: severity chip (watch=amber / alert=red — the dashboard TONE
 * palette), scope chip, human-investigation message, the current-vs-baseline
 * metric line, and the muted investigation hint.
 *
 * Client contract mirrors the /api/signals payload (kept local so the client
 * bundle never imports the server module).
 */

interface SignalMetric {
  current: number;
  baseline: number;
  delta: number;
  ratio: number | null;
}

interface Signal {
  id: string;
  kind: string;
  severity: "watch" | "alert";
  county: string;
  ward: string | null;
  tag: string | null;
  metric: SignalMetric;
  message: string;
  investigationHint: string;
}

interface SignalsPayload {
  generatedAt: string;
  signals: Signal[];
  note: string;
}

/**
 * undefined = loading (SSR renders the shell so the section header is in the
 * initial HTML), null = failed (render nothing — optional widget), object =
 * ready.
 */
type PanelState = SignalsPayload | null | undefined;

export function EarlyWarningPanel({
  scopeMode = "all",
}: {
  scopeMode?: "all" | "mine";
}) {
  const [payload, setPayload] = useState<PanelState>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = scopeMode === "mine" ? "?scope=mine" : "";
        const res = await fetch(`/api/signals${qs}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setPayload(null);
          return;
        }
        const body = (await res.json()) as SignalsPayload;
        if (!cancelled) setPayload(body);
      } catch {
        // early-warning panel is optional; render nothing on failure
        if (!cancelled) setPayload(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeMode]);

  // Silent fail — same error-swallowing contract as QwenImpactCard.
  if (payload === null) return null;

  const signals = payload?.signals ?? [];
  const loading = payload === undefined;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      aria-label="Early-warning signals"
      aria-live="polite"
    >
      <Card className="gap-0 overflow-hidden p-0">
        {/* Header */}
        <div className="flex items-start gap-2 border-b border-border px-4 py-4 sm:px-5">
          <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="size-4" aria-hidden />
          </span>
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              Early-warning signals
            </h2>
            <p className="text-xs text-muted-foreground">
              Unusual aggregate changes, last 7 days vs previous 7 days
            </p>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
            Checking the current window for unusual changes…
          </p>
        ) : signals.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
            No unusual changes in the current window.
          </p>
        ) : (
          <ul>
            {signals.map((s) => {
              const tone =
                s.severity === "alert" ? TONE.escalation : TONE.needs_followup;
              // The completion-drop signal compares rates, not counts.
              const unit = s.kind === "referral_completion_drop" ? "%" : "";
              return (
                <li
                  key={s.id}
                  className="flex flex-col gap-1.5 border-t border-border/60 px-4 py-3.5 sm:px-5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        tone.soft,
                        tone.border,
                        tone.text
                      )}
                    >
                      <span
                        className={cn("size-1.5 rounded-full", tone.dot)}
                        aria-hidden
                      />
                      {s.severity}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {s.ward ? `${s.county} · ${s.ward}` : s.county}
                    </span>
                    {s.tag && (
                      <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {prettyTag(s.tag)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-snug text-foreground">
                    {s.message}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {s.metric.current}
                    {unit} vs {s.metric.baseline}
                    {unit} (Δ {s.metric.delta >= 0 ? "+" : ""}
                    {s.metric.delta}
                    {unit})
                    {s.metric.ratio !== null ? ` · ×${s.metric.ratio}` : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground/80">
                    Where to look: {s.investigationHint}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {/* Fixed framing footnote */}
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
          Deterministic thresholds, no AI · signals require human investigation
          — never automatic action.
        </p>
      </Card>
    </motion.section>
  );
}
