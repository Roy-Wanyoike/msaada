"use client";

import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ShieldCheck,
  Stethoscope,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TONE,
  type AuditEntry,
} from "@/components/msaada/dashboard-helpers";

const EVENT_LABEL: Record<string, string> = {
  triage_classified: "Triage classified",
  crisis_override: "Crisis override",
  fallback_used: "Model fallback",
};

function toneKey(e: AuditEntry) {
  if (e.escalation) return "escalation" as const;
  if (e.classification === "routine") return "routine" as const;
  if (e.classification === "needs_followup") return "needs_followup" as const;
  if (e.classification === "needs_facility_referral")
    return "needs_facility_referral" as const;
  return "teal" as const;
}

function eventIcon(e: AuditEntry) {
  if (e.escalation) return AlertTriangle;
  if (e.classification === "routine") return ShieldCheck;
  if (e.classification === "needs_followup") return Activity;
  if (e.classification === "needs_facility_referral") return Stethoscope;
  return RefreshCw;
}

function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/**
 * De-identified recent-activity strip — the compliance "audit trail" surfaced
 * on the dashboard. Shows truncated CHV labels (chv·xxxx, never the email),
 * the event type, county/ward, and the model's verdict. Never includes
 * observation text or redacted PII.
 */
export function AuditStrip({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      aria-label="Recent triage activity (audit trail)"
    >
      <Card className="px-4 py-4 sm:px-6">
        <CardHeader className="mb-3 flex flex-row items-center gap-2 px-0">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300">
            <Activity className="size-4" aria-hidden />
          </span>
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-semibold leading-tight">
              Recent activity
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Audit trail · de-identified (truncated CHV labels, no observation
              text)
            </p>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <ul className="space-y-1.5">
            {entries.map((e, i) => {
              const tone = TONE[toneKey(e)];
              const Icon = eventIcon(e);
              return (
                <motion.li
                  key={e.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.04, 0.3) }}
                  className="flex items-center gap-2.5 rounded-md border border-border/50 bg-muted/20 px-3 py-2"
                >
                  <span
                    className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md ${tone.soft} ${tone.text}`}
                  >
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-medium text-foreground">
                        {EVENT_LABEL[e.event] ?? e.event}
                      </span>
                      <Badge
                        variant="outline"
                        className={`h-4 border-current/20 px-1 py-0 text-[9px] font-semibold uppercase tracking-wide ${tone.text}`}
                      >
                        {e.escalation
                          ? "Crisis"
                          : (e.classification ?? e.event).replace(/_/g, " ")}
                      </Badge>
                      {e.fallbackUsed && (
                        <Badge
                          variant="outline"
                          className="h-4 border-amber-300 bg-amber-50 px-1 py-0 text-[9px] font-semibold uppercase tracking-wide text-amber-700"
                        >
                          Fallback
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      <span className="font-mono">{e.actorLabel}</span>
                      {" · "}
                      {e.county}
                      {e.ward ? ` · ${e.ward}` : ""}
                      {" · "}
                      {relativeTime(e.createdAt)}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </motion.section>
  );
}
