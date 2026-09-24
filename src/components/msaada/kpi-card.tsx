"use client";

import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "routine" | "needs_followup" | "needs_facility_referral" | "escalation" | "teal";
  icon?: LucideIcon;
  /** index in the grid, used for staggered entrance */
  index?: number;
}

const TONE_CLASSES: Record<
  NonNullable<KpiCardProps["tone"]>,
  { soft: string; border: string; text: string }
> = {
  routine: {
    soft: "bg-emerald-50 dark:bg-emerald-950/40",
    border: "border-emerald-200 dark:border-emerald-900",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  needs_followup: {
    soft: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-900",
    text: "text-amber-700 dark:text-amber-300",
  },
  needs_facility_referral: {
    soft: "bg-orange-50 dark:bg-orange-950/40",
    border: "border-orange-200 dark:border-orange-900",
    text: "text-orange-700 dark:text-orange-300",
  },
  escalation: {
    soft: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-900",
    text: "text-red-700 dark:text-red-300",
  },
  teal: {
    soft: "bg-teal-50 dark:bg-teal-950/40",
    border: "border-teal-200 dark:border-teal-900",
    text: "text-teal-700 dark:text-teal-300",
  },
};

export function KpiCard({
  label,
  value,
  hint,
  tone = "teal",
  icon: Icon,
  index = 0,
}: KpiCardProps) {
  const t = TONE_CLASSES[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: "easeOut" }}
      whileHover={{ y: -3 }}
      className="h-full"
    >
      <Card
        className={cn(
          "relative overflow-hidden gap-0 px-4 py-4 sm:px-5 sm:py-5 border transition-shadow hover:shadow-md",
          t.soft,
          t.border
        )}
      >
        {/* Decorative accent bar (top-left → bottom-right gradient strip) */}
        <span
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-60",
            tone === "routine" && "bg-gradient-to-r from-emerald-400 to-emerald-600",
            tone === "needs_followup" && "bg-gradient-to-r from-amber-400 to-amber-600",
            tone === "needs_facility_referral" && "bg-gradient-to-r from-orange-400 to-orange-600",
            tone === "escalation" && "bg-gradient-to-r from-red-400 to-red-600",
            tone === "teal" && "bg-gradient-to-r from-teal-400 to-teal-600"
          )}
          aria-hidden
        />
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {Icon ? (
            <span
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-background/70 ring-1 ring-border/40",
                t.text
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-3xl font-semibold leading-none tabular-nums text-foreground">
          {value}
        </p>
        {hint ? (
          <p className={cn("mt-2 text-xs font-medium", t.text)}>{hint}</p>
        ) : null}
      </Card>
    </motion.div>
  );
}
