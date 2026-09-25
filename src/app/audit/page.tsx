"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Activity,
  Stethoscope,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Filter,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { COUNTIES } from "@/lib/types";
import { TONE } from "@/components/msaada/dashboard-helpers";
import type { AuditEntry } from "@/components/msaada/dashboard-helpers";
import { AppNav } from "@/components/msaada/AppNav";

interface AuditPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const EVENT_LABEL: Record<string, string> = {
  triage_classified: "Triage classified",
  crisis_override: "Crisis override",
  fallback_used: "Model fallback",
};

const EVENT_OPTIONS = [
  { value: "all", label: "All events" },
  { value: "triage_classified", label: "Triage classified" },
  { value: "crisis_override", label: "Crisis override" },
  { value: "fallback_used", label: "Model fallback" },
];

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
  return ShieldAlert;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

export default function AuditPage() {
  const [data, setData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [county, setCounty] = useState<string>("all");
  const [event, setEvent] = useState<string>("all");
  const [escalationOnly, setEscalationOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (county !== "all") params.set("county", county);
      if (event !== "all") params.set("event", event);
      if (escalationOnly) params.set("escalation", "true");
      const res = await fetch(`/api/audit?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as AuditPage;
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [page, county, event, escalationOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <div className="flex min-h-screen flex-col bg-background lg:pl-64 print:pl-0">
      <AppNav />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {/* Header */}
          <header className="mb-6 sm:mb-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300"
                  >
                    <ScrollText className="mr-1 size-3" aria-hidden />
                    Compliance audit trail
                  </Badge>
                  <span className="text-xs font-medium text-muted-foreground">
                    De-identified
                  </span>
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  Audit log
                </h1>
                <p className="max-w-2xl text-sm text-foreground/70">
                  Every triage event — who (truncated), when, where, and the
                  model&apos;s verdict. Never includes observation text or
                  redacted PII. The system of record for safety incidents.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void load()}
                  className="h-10 min-h-[44px] px-3"
                  aria-label="Refresh audit log"
                >
                  <RefreshCw className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
            <Separator className="mt-6" />
          </header>

          {/* Filters */}
          <Card className="mb-4 px-4 py-3 sm:px-6">
            <CardContent className="flex flex-wrap items-end gap-3 px-0">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Filter className="mr-1 inline size-3" aria-hidden />
                  County
                </p>
                <Select value={county} onValueChange={(v) => { setCounty(v); setPage(1); }}>
                  <SelectTrigger className="h-9 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All counties</SelectItem>
                    {COUNTIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Event
                </p>
                <Select value={event} onValueChange={(v) => { setEvent(v); setPage(1); }}>
                  <SelectTrigger className="h-9 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant={escalationOnly ? "destructive" : "outline"}
                size="sm"
                className="h-9"
                onClick={() => { setEscalationOnly((v) => !v); setPage(1); }}
                aria-pressed={escalationOnly}
              >
                <AlertTriangle className="mr-1 size-3.5" aria-hidden />
                Escalations only
              </Button>
              <div className="ml-auto text-xs text-muted-foreground">
                {data ? `${data.total} record${data.total === 1 ? "" : "s"}` : "—"}
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : error ? (
            <Card className="px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
                Retry
              </Button>
            </Card>
          ) : !data || data.entries.length === 0 ? (
            <Card className="px-6 py-12 text-center">
              <ScrollText className="mx-auto size-8 text-muted-foreground/50" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                No audit entries match these filters.
              </p>
            </Card>
          ) : (
            <>
              {/* Header row (desktop) */}
              <div className="hidden gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_0.8fr]">
                <span>When</span>
                <span>Actor</span>
                <span>Event</span>
                <span>County · Ward</span>
                <span>Verdict</span>
                <span className="text-right">Flags</span>
              </div>
              <Separator className="mb-1" />
              <ul className="space-y-1.5">
                {data.entries.map((e, i) => {
                  const tone = TONE[toneKey(e)];
                  const Icon = eventIcon(e);
                  return (
                    <motion.li
                      key={e.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.25) }}
                    >
                      <div className="grid items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2.5 transition-colors hover:bg-muted/30 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_0.8fr]">
                        <span className="font-mono text-xs text-muted-foreground">
                          <span className="inline md:hidden text-muted-foreground mr-1">When:</span>
                          {fmtTime(e.createdAt)}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          <span className="inline md:hidden text-muted-foreground mr-1">Actor:</span>
                          {e.actorLabel}
                        </span>
                        <span className="text-xs font-medium text-foreground">
                          <span className="inline md:hidden text-muted-foreground mr-1 font-normal">Event:</span>
                          {EVENT_LABEL[e.event] ?? e.event}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          <span className="inline md:hidden text-muted-foreground mr-1">County · Ward:</span>
                          {e.county}
                          {e.ward ? ` · ${e.ward}` : ""}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline md:hidden text-muted-foreground mr-1">Verdict:</span>
                          <span
                            className={`inline-flex size-5 shrink-0 items-center justify-center rounded ${tone.soft} ${tone.text}`}
                          >
                            <Icon className="size-3" aria-hidden />
                          </span>
                          <Badge
                            variant="outline"
                            className={`h-5 border-current/20 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide ${tone.text}`}
                          >
                            {e.escalation
                              ? "Crisis"
                              : (e.classification ?? "—").replace(/_/g, " ")}
                          </Badge>
                        </span>
                        <span className="flex items-center justify-start gap-1 md:justify-end">
                          <span className="inline md:hidden text-muted-foreground mr-1">Flags:</span>
                          {e.escalation && (
                            <Badge variant="outline" className="h-5 border-red-300 bg-red-50 px-1.5 py-0 text-[9px] font-semibold uppercase text-red-700">
                              <AlertTriangle className="mr-0.5 size-2.5" aria-hidden />
                              Crisis
                            </Badge>
                          )}
                          {e.fallbackUsed && (
                            <Badge variant="outline" className="h-5 border-amber-300 bg-amber-50 px-1.5 py-0 text-[9px] font-semibold uppercase text-amber-700">
                              Fallback
                            </Badge>
                          )}
                        </span>
                      </div>
                    </motion.li>
                  );
                })}
              </ul>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 min-h-[44px]"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                    Prev
                  </Button>
                  <span className="px-3 text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 min-h-[44px]"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="mt-auto border-t bg-background/80 backdrop-blur" role="contentinfo">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            Msaada audit log · Compliance trail · De-identified (truncated CHV
            labels, no observation text) · TODO: RBAC for compliance-officer role
          </p>
        </div>
      </footer>
    </div>
  );
}
