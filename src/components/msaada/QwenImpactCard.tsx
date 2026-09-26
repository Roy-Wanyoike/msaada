"use client";

import { useEffect, useState } from "react";
import { Cpu, Scale, Sparkles, UserCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  label: string;
  performer: "qwen" | "rules";
  humanConfirms?: boolean;
  calls: number;
}

interface ModelHealth {
  model: string;
  calls: number;
  ok: number;
  okRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  fallbackShare: number | null;
}

interface Activity {
  days: number;
  coverage: { qwenSteps: number; totalSteps: number; percent: number; activeQwenSteps: number };
  totals: { calls: number; ok: number; successRate: number | null };
  primaryModel?: string;
  modelHealth?: ModelHealth[];
  steps: Step[];
  models: { model: string; calls: number }[];
}

/**
 * "Qwen at work": which steps of the case journey Qwen performs, with live
 * evidence (successful calls per step, success rate, models) from the
 * AiActivity log. Coverage is structural; the counts show it's really used.
 */
export function QwenImpactCard({ days }: { days: number }) {
  const [data, setData] = useState<Activity | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ai/activity?days=${days}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as Activity;
        if (!cancelled) setData(body);
      } catch {
        // meter is optional; render nothing on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (!data) return null;
  const { coverage, totals } = data;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="grid gap-6 border-b border-border p-5 md:grid-cols-[auto_1fr] md:items-center">
        <div className="flex items-center gap-4">
          <span className="inline-flex size-12 items-center justify-center rounded-xl bg-brand-950 text-white">
            <Sparkles className="size-6" aria-hidden />
          </span>
          <div>
            <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
              {coverage.percent}%
            </p>
            <p className="text-sm text-muted-foreground">
              of the case journey runs on Qwen ({coverage.qwenSteps} of {coverage.totalSteps} steps)
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-sm md:justify-self-end">
          <div>
            <dt className="text-xs text-muted-foreground">Qwen calls, last {data.days} days</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">{totals.ok}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Success rate</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">
              {totals.successRate === null ? "—" : `${totals.successRate}%`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Steps in use</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">
              {coverage.activeQwenSteps}/{coverage.qwenSteps}
            </dd>
          </div>
        </dl>
      </div>

      <ol className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
        {data.steps.map((s, i) => (
          <li
            key={s.id}
            className={cn(
              "flex items-center gap-3 px-5 py-2.5 text-sm",
              "sm:border-b sm:border-border",
              i % 2 === 0 && "sm:border-r"
            )}
          >
            <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
            {s.performer === "qwen" ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                {s.humanConfirms ? <UserCheck className="size-3" aria-hidden /> : <Cpu className="size-3" aria-hidden />}
                {s.humanConfirms ? "Qwen + you" : "Qwen"}
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Scale className="size-3" aria-hidden />
                Fixed rules
              </span>
            )}
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {s.performer === "qwen" ? s.calls : "—"}
            </span>
          </li>
        ))}
      </ol>

      {data.modelHealth && data.modelHealth.length > 0 && (
        <div className="border-t border-border px-5 py-3">
          <p className="text-xs font-medium text-muted-foreground">
            Model health — failover chain, measured per model (ok rate · p50/p95 latency)
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {data.modelHealth.slice(0, 4).map((m) => (
              <div
                key={m.model}
                className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-foreground" title={m.model}>
                  {m.model.split("/").pop()}
                  {m.model === data.primaryModel && (
                    <span className="ml-1.5 rounded bg-brand-950 px-1 py-px font-sans text-[10px] font-medium text-white">
                      primary
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {m.okRate === null ? "—" : `${m.okRate}%`} · {m.p50LatencyMs === null ? "—" : `${m.p50LatencyMs}ms`}
                  {m.p95LatencyMs !== null && ` / ${m.p95LatencyMs}ms`}
                  {m.fallbackShare !== null && m.fallbackShare > 0 && ` · failover ${m.fallbackShare}%`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="px-5 py-3 text-xs text-muted-foreground">
        Safety routing and the audit trail stay on fixed, versioned rules by design: Qwen interprets,
        rules decide who gets escalated, people control care. If a model is down the next in the chain
        answers; if the whole chain fails, deterministic rules take over — the CHV always gets a result.
      </p>
    </Card>
  );
}
