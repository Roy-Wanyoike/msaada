"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  Info,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * AI case summary (issue #55) — collapsible advisory panel for the case
 * detail cards. Fetches POST /api/response-cases/[id]/summary:
 *  - the server builds the prompt from structured fields only,
 *  - serves a cached summary when one is fresh (cached: true),
 *  - falls back to a deterministic bullet summary when the model chain is
 *    down or unconfigured (fallbackUsed: true) — never a 5xx for a model
 *    outage.
 *
 * Human-in-the-loop: the panel always renders the "AI-generated, advisory
 * only — verify with the CHV" banner. It never blocks or changes case
 * state. Loading / empty / error states are all handled inline.
 */

interface SummaryPayload {
  narrative: string;
  themes: string[];
  outstandingActions: string[];
}

interface SummaryResponse {
  advisory?: boolean;
  cached?: boolean;
  summary?: SummaryPayload;
  fallbackUsed?: boolean | null;
  model?: string;
  error?: string;
}

type PanelState =
  | { phase: "closed" }
  | { phase: "loading" }
  | { phase: "ready"; data: SummaryResponse }
  | { phase: "error"; message: string };

export function CaseSummaryPanel({ caseId }: { caseId: string }) {
  const [state, setState] = useState<PanelState>({ phase: "closed" });
  const [open, setOpen] = useState(false);
  // Guards double-fetches on fast double-clicks / strict-mode remounts.
  const inflight = useRef(false);

  const fetchSummary = useCallback(
    async (refresh: boolean) => {
      if (inflight.current) return;
      inflight.current = true;
      setState({ phase: "loading" });
      try {
        const res = await fetch(
          `/api/response-cases/${encodeURIComponent(caseId)}/summary`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(refresh ? { refresh: true } : {}),
          }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          // 401/403/404 are real errors — show them. Model problems never
          // reach this branch (the endpoint fails soft with 200).
          setState({
            phase: "error",
            message:
              body.error === "FORBIDDEN"
                ? "You are not allowed to view summaries for this case."
                : (body.error ?? `Request failed (${res.status})`),
          });
          return;
        }
        const data = (await res.json()) as SummaryResponse;
        if (!data.summary?.narrative) {
          setState({ phase: "error", message: "Summary was empty." });
          return;
        }
        setState({ phase: "ready", data });
      } catch {
        setState({
          phase: "error",
          message: "Network error — couldn't reach the server.",
        });
      } finally {
        inflight.current = false;
      }
    },
    [caseId]
  );

  function toggle() {
    const next = !open;
    setOpen(next);
    // Fetch lazily on first expand (cached server-side, so re-opens are free).
    if (next && state.phase === "closed") void fetchSummary(false);
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-xs font-semibold text-foreground transition-colors hover:bg-muted/70"
      >
        <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="flex-1">AI case summary</span>
        {state.phase === "loading" && (
          <RefreshCw className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
        )}
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="rounded-b-lg border border-t-0 border-border bg-muted/20 px-3 pb-3 pt-3">
              {/* Advisory banner — ALWAYS visible (human-in-the-loop). */}
              <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                AI-generated, advisory only — verify with the CHV.
              </p>

              {state.phase === "loading" && (
                <div className="mt-2 space-y-2" aria-busy="true">
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                  <p className="text-[11px] text-muted-foreground">
                    Building the summary from structured case data…
                  </p>
                </div>
              )}

              {state.phase === "error" && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <div className="flex-1">
                    <p>{state.message}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2 h-8 px-2 text-xs"
                      onClick={() => void fetchSummary(false)}
                    >
                      <RefreshCw className="size-3" aria-hidden />
                      Retry
                    </Button>
                  </div>
                </div>
              )}

              {state.phase === "ready" && state.data.summary && (
                <div className="mt-2">
                  <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {state.data.summary.narrative}
                  </p>

                  {state.data.summary.outstandingActions.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Outstanding
                      </p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-foreground/90">
                        {state.data.summary.outstandingActions.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {state.data.fallbackUsed === true && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                        deterministic fallback (model unavailable)
                      </span>
                    )}
                    {state.data.fallbackUsed === false && state.data.model && (
                      <span className="rounded bg-accent px-1.5 py-0.5 font-medium text-accent-foreground">
                        {state.data.model.split("/").pop()}
                      </span>
                    )}
                    {state.data.cached && <span>cached</span>}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                      onClick={() => void fetchSummary(true)}
                    >
                      <RefreshCw className="size-3" aria-hidden />
                      Refresh summary
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
