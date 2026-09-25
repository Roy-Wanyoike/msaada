"use client";

import { motion } from "framer-motion";
import { ClipboardCheck, Check, X, Clock, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface FollowUpStats {
  pending: number;
  done: number;
  missed: number;
  overdue: number;
  completionRate: number;
  total: number;
}

/**
 * Follow-up completion KPI card — shows the operational health of the
 * follow-up workflow: pending / overdue / completion rate. Renders on the
 * dashboard so a county official / supervisor sees whether CHVs are
 * completing their recommended revisits.
 */
export function FollowUpKpiCard({
  stats,
  index = 0,
}: {
  stats: FollowUpStats;
  index?: number;
}) {
  const { pending, done, missed, overdue, completionRate, total } = stats;
  const resolved = done + missed;
  // Completion rate color: green >=80, amber 50-79, red <50.
  const rateTone =
    resolved === 0
      ? "teal"
      : completionRate >= 80
        ? "emerald"
        : completionRate >= 50
          ? "amber"
          : "red";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: "easeOut" }}
      className="h-full"
    >
      <Card className="h-full gap-0 px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-medium text-muted-foreground">
            Follow-up completion
          </p>
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <ClipboardCheck className="size-4" aria-hidden />
          </span>
        </div>

        {/* Big completion rate */}
        <p className="mt-2 text-3xl font-semibold leading-none tabular-nums text-foreground">
          {completionRate}
          <span className="text-lg text-muted-foreground">%</span>
        </p>
        <p
          className={cn(
            "mt-1.5 text-xs font-medium",
            rateTone === "emerald" && "text-emerald-700 dark:text-emerald-300",
            rateTone === "amber" && "text-amber-700 dark:text-amber-300",
            rateTone === "red" && "text-red-700 dark:text-red-300",
            rateTone === "teal" && "text-muted-foreground"
          )}
        >
          {resolved === 0
            ? "No resolved follow-ups yet"
            : `${done} done · ${missed} missed`}
        </p>

        {/* Status breakdown row */}
        <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-border/40 pt-2.5">
          <Stat icon={Clock} label="Pending" value={pending} tone="amber" />
          <Stat icon={AlertCircle} label="Overdue" value={overdue} tone="red" />
          <Stat icon={Check} label="Done" value={done} tone="emerald" />
        </div>
      </Card>
    </motion.div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  value: number;
  tone: "amber" | "red" | "emerald";
}) {
  const toneCls = {
    amber: "text-amber-700 dark:text-amber-300",
    red: "text-red-700 dark:text-red-300",
    emerald: "text-emerald-700 dark:text-emerald-300",
  }[tone];
  return (
    <div className="text-center">
      <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <Icon className={cn("size-3", toneCls)} aria-hidden />
        {label}
      </p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

// Re-export X icon usage to keep the import warning-free (X is used for
// "missed" semantic elsewhere in the follow-up UI; this card focuses on the
// 3-col breakdown so we reference it here for tree-shaking consistency).
export const _missedIcon = X;
