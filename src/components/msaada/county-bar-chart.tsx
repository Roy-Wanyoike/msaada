"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  COLORS,
  formatDay,
  type CountyAggregate,
} from "@/components/msaada/dashboard-helpers";

interface Props {
  data: CountyAggregate[];
}

const LEGEND_PAYLOAD = [
  { value: "Routine", color: COLORS.routine },
  { value: "Follow-up", color: COLORS.needs_followup },
  { value: "Facility", color: COLORS.needs_facility_referral },
  { value: "Escalation", color: COLORS.escalation },
];

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: p.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{p.name}:</span>
            <span className="font-medium tabular-nums text-foreground">
              {p.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LegendRenderer() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LEGEND_PAYLOAD.map((l) => (
        <span key={l.value} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: l.color }}
            aria-hidden
          />
          {l.value}
        </span>
      ))}
    </div>
  );
}

export function CountyBarChart({ data }: Props) {
  const ariaSummary = data
    .map(
      (c) =>
        `${c.county}: routine ${c.routine}, follow-up ${c.needs_followup}, facility ${c.needs_facility_referral}, escalation ${c.escalation}`
    )
    .join("; ");

  return (
    <div
      className="w-full"
      role="img"
      aria-label={`County triage breakdown. ${ariaSummary}`}
    >
      <div className="mb-3">
        <LegendRenderer />
      </div>
      <div className="min-h-[300px] w-full">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 16, left: -8, bottom: 0 }}
            barGap={2}
            barCategoryGap="22%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.muted} vertical={false} opacity={0.35} />
            <XAxis
              dataKey="county"
              tick={{ fontSize: 12, fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
              minTickGap={8}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={36}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
            />
            <Bar
              dataKey="routine"
              name="Routine"
              fill={COLORS.routine}
              radius={[3, 3, 0, 0]}
              maxBarSize={36}
            />
            <Bar
              dataKey="needs_followup"
              name="Follow-up"
              fill={COLORS.needs_followup}
              radius={[3, 3, 0, 0]}
              maxBarSize={36}
            />
            <Bar
              dataKey="needs_facility_referral"
              name="Facility"
              fill={COLORS.needs_facility_referral}
              radius={[3, 3, 0, 0]}
              maxBarSize={36}
            />
            {/* Escalation as a thin marker line on top — distinct color, distinct shape. */}
            <Line
              type="monotone"
              dataKey="escalation"
              name="Escalation"
              stroke={COLORS.escalation}
              strokeWidth={2}
              dot={{ r: 3, fill: COLORS.escalation }}
              activeDot={{ r: 5 }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface DailyTrendProps {
  data: Array<{
    day: string;
    routine: number;
    needs_followup: number;
    needs_facility_referral: number;
    escalation: number;
    total: number;
  }>;
}

const DAILY_LEGEND = [
  { value: "Routine", color: COLORS.routine },
  { value: "Follow-up", color: COLORS.needs_followup },
  { value: "Facility", color: COLORS.needs_facility_referral },
  { value: "Escalation", color: COLORS.escalation },
];

export function DailyTrendChart({ data }: DailyTrendProps) {
  const display = data.map((d) => ({ ...d, label: formatDay(d.day) }));
  const ariaSummary = data
    .map(
      (d) =>
        `${formatDay(d.day)}: routine ${d.routine}, follow-up ${d.needs_followup}, facility ${d.needs_facility_referral}, escalation ${d.escalation}`
    )
    .join("; ");

  return (
    <div
      className="w-full"
      role="img"
      aria-label={`Daily triage trend, last 14 days. ${ariaSummary}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {DAILY_LEGEND.map((l) => (
          <span key={l.value} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: l.color }}
              aria-hidden
            />
            {l.value}
          </span>
        ))}
      </div>
      <div className="min-h-[300px] w-full">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={display}
            margin={{ top: 8, right: 16, left: -8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.muted} vertical={false} opacity={0.35} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={36}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "currentColor", strokeOpacity: 0.2 }}
            />
            <Line
              type="monotone"
              dataKey="routine"
              name="Routine"
              stroke={COLORS.routine}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="needs_followup"
              name="Follow-up"
              stroke={COLORS.needs_followup}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="needs_facility_referral"
              name="Facility"
              stroke={COLORS.needs_facility_referral}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="escalation"
              name="Escalation"
              stroke={COLORS.escalation}
              strokeWidth={2.5}
              strokeDasharray="4 3"
              dot={{ r: 2.5, fill: COLORS.escalation }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
