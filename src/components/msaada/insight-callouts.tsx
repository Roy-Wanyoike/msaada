"use client";

import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import {
  AlertTriangle,
  Activity,
  TrendingUp,
  TrendingDown,
  Tag,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TONE,
  type Insight,
} from "@/components/msaada/dashboard-helpers";

const TONE_ICON: Record<Insight["tone"], typeof Activity> = {
  routine: ShieldCheck,
  needs_followup: Activity,
  needs_facility_referral: AlertTriangle,
  escalation: AlertTriangle,
  teal: Tag,
};

function DeltaArrow({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <Icon
      className={cn(
        "size-3.5",
        up ? "text-red-500" : "text-emerald-500"
      )}
      aria-hidden
    />
  );
}

interface Props {
  insights: Insight[];
  /** Optional weekly delta to show a directional arrow on a callout. */
  weeklyDeltaNumber?: number | null;
}

export function InsightCallouts({ insights, weeklyDeltaNumber }: Props) {
  if (insights.length === 0) {
    return (
      <Card className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
        Not enough data yet to surface narrative insights. Insights appear
        once there are observations across more than one day or county.
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {insights.map((ins, i) => {
        const tone = TONE[ins.tone];
        const Icon = TONE_ICON[ins.tone];
        const showArrow =
          weeklyDeltaNumber != null && ins.id === "followup-trend";
        return (
          <motion.div
            key={ins.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.08, ease: "easeOut" }}
            className="h-full"
          >
            <Card
              className={cn(
                "flex h-full flex-col gap-2 border px-4 py-4 sm:px-5",
                tone.soft,
                tone.border
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-background/70",
                    tone.text
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </span>
                <p className={cn("text-sm font-semibold leading-tight", tone.text)}>
                  {ins.title}
                </p>
                {showArrow ? (
                  <DeltaArrow delta={weeklyDeltaNumber ?? 0} />
                ) : null}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {ins.body}
              </p>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
