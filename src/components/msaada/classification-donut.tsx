"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { COLORS, CLASS_LABEL, pct } from "@/components/msaada/dashboard-helpers";

interface Props {
  totals: {
    total: number;
    routine: number;
    needs_followup: number;
    needs_facility_referral: number;
    escalation: number;
  };
}

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    payload?: { color?: string };
    color?: string;
  }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <div className="flex items-center gap-2">
        <span
          className="inline-block size-2 rounded-full"
          style={{ background: p.payload?.color ?? p.color }}
          aria-hidden
        />
        <span className="font-medium text-foreground">{p.name}</span>
      </div>
      <p className="mt-0.5 tabular-nums text-muted-foreground">
        {p.value} ({pct(p.value ?? 0, (p.payload as { total?: number })?.total ?? 0)}%)
      </p>
    </div>
  );
}

export function ClassificationDonut({ totals }: Props) {
  const data = [
    { name: CLASS_LABEL.routine, value: totals.routine, color: COLORS.routine, total: totals.total },
    {
      name: CLASS_LABEL.needs_followup,
      value: totals.needs_followup,
      color: COLORS.needs_followup,
      total: totals.total,
    },
    {
      name: CLASS_LABEL.needs_facility_referral,
      value: totals.needs_facility_referral,
      color: COLORS.needs_facility_referral,
      total: totals.total,
    },
    {
      name: CLASS_LABEL.escalation,
      value: totals.escalation,
      color: COLORS.escalation,
      total: totals.total,
    },
  ].filter((d) => d.value > 0);

  const ariaSummary = data
    .map((d) => `${d.name}: ${d.value} (${pct(d.value, totals.total)}%)`)
    .join("; ");

  return (
    <div
      className="w-full"
      role="img"
      aria-label={`Classification distribution. ${ariaSummary}`}
    >
      <div className="relative min-h-[300px] w-full">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Tooltip content={<DonutTooltip />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={72}
              outerRadius={110}
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="none"
            >
              {data.map((entry, i) => (
                <Cell key={`${entry.name}-${i}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total
          </span>
          <span className="text-3xl font-semibold leading-none tabular-nums text-foreground">
            {totals.total}
          </span>
          <span className="mt-1 text-xs text-muted-foreground">observations</span>
        </div>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4 sm:gap-x-6">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: d.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{d.name}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground">
              {pct(d.value, totals.total)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
