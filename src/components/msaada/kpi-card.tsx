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

/** Tone colours only the icon chip; the card itself stays neutral. */
const TONE_CLASSES: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  routine: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  needs_followup: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  needs_facility_referral: "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
  escalation: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  teal: "bg-muted text-muted-foreground",
};

export function KpiCard({
  label,
  value,
  hint,
  tone = "teal",
  icon: Icon,
  index = 0,
}: KpiCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04, ease: "easeOut" }}
      className="h-full"
    >
      <Card className="h-full gap-0 px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-medium text-muted-foreground">
            {label}
          </p>
          {Icon ? (
            <span
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
                TONE_CLASSES[tone]
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
          {value}
        </p>
        {hint ? (
          <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </Card>
    </motion.div>
  );
}
