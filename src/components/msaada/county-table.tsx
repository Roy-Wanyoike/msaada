"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  proxyCountyWeeklyDelta,
  type DashboardStats,
} from "@/components/msaada/dashboard-helpers";
import { cn } from "@/lib/utils";

interface Props {
  stats: DashboardStats;
}

export function CountyTable({ stats }: Props) {
  const { byCounty, totals } = stats;
  const hasProxyNote = byCounty.length > 0;

  return (
    <div className="w-full">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[28%]">County</TableHead>
            <TableHead className="text-right tabular-nums">Total</TableHead>
            <TableHead className="text-right tabular-nums">Routine</TableHead>
            <TableHead className="text-right tabular-nums">Follow-up</TableHead>
            <TableHead className="text-right tabular-nums">Facility</TableHead>
            <TableHead className="text-right tabular-nums">Escalation</TableHead>
            <TableHead className="text-right tabular-nums">
              Last 7d Δ<sup className="text-[10px]">‡</sup>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {byCounty.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                No county data yet.
              </TableCell>
            </TableRow>
          ) : (
            byCounty.map((c) => {
              const { delta } = proxyCountyWeeklyDelta(c, stats);
              const tone =
                delta > 0
                  ? "text-red-600 dark:text-red-400"
                  : delta < 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground";
              const sign = delta > 0 ? "+" : delta < 0 ? "" : "";
              const share = totals.total > 0 ? Math.round((c.total / totals.total) * 1000) / 10 : 0;
              return (
                <TableRow key={c.county}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {c.county}
                      <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                        {share}% of total
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {c.total}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {c.routine}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                    {c.needs_followup}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-orange-600 dark:text-orange-400">
                    {c.needs_facility_referral}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                    {c.escalation}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums font-medium", tone)}>
                    {delta === 0 ? "—" : `${sign}${delta}`}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {hasProxyNote ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          <sup>‡</sup> Proxy per-county weekly delta. The{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">/api/dashboard</code>{" "}
          contract currently exposes a regional (all-counties){" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">byDay</code>{" "}
          series and per-county all-time totals — not per-county per-day.
          Until that contract is extended, each county&apos;s weekly delta is
          approximated as the regional weekly delta weighted by the county&apos;s
          share of total observations. Direction is reliable; magnitude is
          indicative only.
        </p>
      ) : null}
    </div>
  );
}
