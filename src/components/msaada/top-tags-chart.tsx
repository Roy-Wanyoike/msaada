"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { COLORS, prettyTag, type TagAggregate } from "@/components/msaada/dashboard-helpers";

interface Props {
  data: TagAggregate[];
}

function TagTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TagAggregate; color?: string }>;
}) {
  if (!active || !payload || payload.length === 0 || !payload[0].payload) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{prettyTag(p.aggregateTag)}</p>
      <p className="mt-0.5 tabular-nums text-muted-foreground">{p.count} cases</p>
    </div>
  );
}

export function TopTagsChart({ data }: Props) {
  const sorted = [...data].sort((a, b) => b.count - a.count);
  const ariaSummary = sorted
    .map((t) => `${prettyTag(t.aggregateTag)}: ${t.count}`)
    .join("; ");

  return (
    <div
      className="w-full"
      role="img"
      aria-label={`Top aggregate triage tags. ${ariaSummary}`}
    >
      <div className="min-h-[300px] w-full">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={sorted}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
            barCategoryGap={8}
          >
            <XAxis
              type="number"
              tick={{ fontSize: 12, fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="aggregateTag"
              tick={{ fontSize: 11, fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
              width={120}
              tickFormatter={(v: string) =>
                prettyTag(v).length > 18
                  ? prettyTag(v).slice(0, 17) + "…"
                  : prettyTag(v)
              }
            />
            <Tooltip
              content={<TagTooltip />}
              cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
            />
            <Bar dataKey="count" name="Cases" radius={[0, 3, 3, 0]} maxBarSize={18}>
              {sorted.map((entry, i) => (
                <Cell key={`${entry.aggregateTag}-${i}`} fill={COLORS.teal} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
