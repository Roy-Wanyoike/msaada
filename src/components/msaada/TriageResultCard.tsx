"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Info,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Classification, TriageRecordDTO } from "@/lib/types";

const CLASS_LABELS: Record<Classification, string> = {
  routine: "Routine",
  needs_followup: "Needs follow-up",
  needs_facility_referral: "Needs facility referral",
};

const CLASS_BADGE_CLASSES: Record<Classification, string> = {
  routine: "bg-emerald-600 text-white",
  needs_followup: "bg-amber-500 text-white",
  needs_facility_referral: "bg-orange-600 text-white",
};

const CLASS_RING_CLASSES: Record<Classification, string> = {
  routine: "border-emerald-200 bg-emerald-50",
  needs_followup: "border-amber-200 bg-amber-50",
  needs_facility_referral: "border-orange-200 bg-orange-50",
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function TriageResultCard({
  record,
  onSubmitAnother,
}: {
  record: TriageRecordDTO;
  onSubmitAnother: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className={`rounded-xl border p-5 shadow-sm ${CLASS_RING_CLASSES[record.classification]}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          className={`px-3 py-1 text-sm font-bold ${CLASS_BADGE_CLASSES[record.classification]}`}
        >
          {CLASS_LABELS[record.classification]}
        </Badge>
        {record.aggregateTag && (
          <Badge variant="outline" className="bg-white text-foreground">
            {record.aggregateTag}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatTimestamp(record.createdAt)}
        </span>
      </div>

      {record.fallbackUsed && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Caution fallback applied.</span>{" "}
            Model output could not be parsed — defaulted to caution
            (needs_followup). Review manually if in doubt.
          </p>
        </div>
      )}

      {/* CHP next action — most important field */}
      <div className="mt-4 rounded-lg bg-white p-4 shadow-xs">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <ClipboardList className="h-4 w-4" aria-hidden="true" />
          CHP next action
        </div>
        <p className="mt-1.5 text-base font-semibold leading-relaxed text-foreground">
          {record.chpNextAction ?? "No action provided."}
        </p>
      </div>

      {record.observedIndicators.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Observed indicators
          </p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {record.observedIndicators.map((ind, i) => (
              <li
                key={`${ind}-${i}`}
                className="flex items-start gap-2 rounded-md bg-white/70 px-3 py-1.5 text-sm"
              >
                <CheckCircle2
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                <span>{ind}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {record.confidenceNote && (
        <div className="mt-4 flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-medium">Model confidence note:</span>{" "}
            {record.confidenceNote}
          </p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        <span>
          Record <span className="font-mono">{record.id}</span> · saved
          de-identified (county: {record.county}
          {record.ward ? `, ward: ${record.ward}` : ""}).
        </span>
      </div>

      <Separator className="my-4" />

      <Button
        type="button"
        variant="outline"
        className="h-11 w-full"
        onClick={onSubmitAnother}
      >
        <RefreshCw className="h-4 w-4" />
        Submit another observation
      </Button>
    </motion.div>
  );
}
