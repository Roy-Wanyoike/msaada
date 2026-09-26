"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  RefreshCw,
  Stethoscope,
  Siren,
  AlertCircle,
  Circle,
  CheckCircle2,
  XCircle,
  Clock,
  MapPin,
  Home,
  User,
  Filter,
  Send,
  Eye,
  Activity,
  X,
  Hourglass,
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
import { cn } from "@/lib/utils";
import { AppNav } from "@/components/msaada/AppNav";
import { ReferralHandover, ReferralStatusAdvance } from "@/components/msaada/ReferralHandover";

/** A referral row as returned by GET /api/referrals. */
interface ReferralDTO {
  id: string;
  referralCode: string;
  encounterId: string;
  householdId: string;
  memberId: string;
  category: string;
  priority: string;
  destination: string | null;
  status: string;
  createdById: string;
  createdAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
  followUpRequired: boolean;
  householdLabel: string;
  memberDisplayName: string;
}

type ReferralStatus =
  | "created"
  | "sent"
  | "acknowledged"
  | "in_progress"
  | "completed"
  | "declined"
  | "cancelled"
  | "expired";

type LoadState = "loading" | "ready" | "error";

const PENDING_STATES: ReferralStatus[] = [
  "created",
  "sent",
  "acknowledged",
  "in_progress",
];

/** Status metadata — tone-coded, NO indigo/blue (per design rules). */
const STATUS_META: Record<
  ReferralStatus,
  { label: string; icon: typeof Eye; tone: string; dot: string }
> = {
  created: {
    label: "Created",
    icon: Eye,
    tone:
      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300",
    dot: "bg-teal-500",
  },
  sent: {
    label: "Sent",
    icon: Send,
    tone:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  acknowledged: {
    label: "Acknowledged",
    icon: CheckCircle2,
    tone:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  in_progress: {
    label: "In progress",
    icon: Activity,
    tone:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    tone:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  declined: {
    label: "Declined",
    icon: XCircle,
    tone:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
    dot: "bg-red-500",
  },
  cancelled: {
    label: "Cancelled",
    icon: X,
    tone: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
  expired: {
    label: "Expired",
    icon: Hourglass,
    tone:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
    dot: "bg-red-500",
  },
};

const STATUS_FILTER_VALUES: Array<{ value: "all" | ReferralStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "created", label: "Created" },
  { value: "sent", label: "Sent" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
];

const CATEGORY_LABELS: Record<string, string> = {
  mental_health: "Mental health",
  crisis_self_harm: "Crisis / self-harm",
  maternal: "Maternal",
  child_health: "Child health",
  social_support: "Social support",
};

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(month / 12)}y ago`;
}

function PriorityIcon({ priority }: { priority: string }) {
  const cls = "size-3.5";
  if (priority === "emergency") {
    return <Siren className={cn(cls, "text-red-600 dark:text-red-400")} aria-hidden />;
  }
  if (priority === "urgent") {
    return <AlertCircle className={cn(cls, "text-amber-600 dark:text-amber-400")} aria-hidden />;
  }
  return <Circle className={cn(cls, "text-teal-600 dark:text-teal-400")} aria-hidden />;
}

function priorityTone(priority: string): string {
  if (priority === "emergency") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
  }
  if (priority === "urgent") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
  }
  return "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300";
}

function categoryTone(category: string): string {
  if (category === "crisis_self_harm") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
  }
  if (category === "mental_health") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
  }
  if (category === "maternal" || category === "child_health") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  return "border-border bg-muted text-muted-foreground";
}

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState<ReferralDTO[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<"all" | ReferralStatus>("all");
  // Current session user — decides who may advance a referral (the owner
  // CHV, or any county admin per the PATCH RBAC).
  const [me, setMe] = useState<{ id: string; role: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { chv: { id: string; role: string | null } | null } | null) => {
        if (!cancelled && d?.chv) setMe({ id: d.chv.id, role: d.chv.role });
      })
      .catch(() => {
        // Anonymous — every control renders in its disabled state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const qs = status !== "all" ? `?status=${status}` : "";
      const res = await fetch(`/api/referrals${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { referrals: ReferralDTO[] };
      setReferrals(data.referrals ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Optimistic refresh: swap the advanced referral into the list so the
  // summary KPIs (pending/completed/declined) reflect the live state
  // immediately, without a full reload.
  const handleUpdated = useCallback(
    (
      updated: Pick<
        ReferralDTO,
        "id" | "status" | "acknowledgedAt" | "completedAt"
      >
    ) => {
      setReferrals((prev) =>
        prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
      );
    },
    []
  );

  const canAct = useCallback(
    (r: ReferralDTO) =>
      !!me && (r.createdById === me.id || me.role === "county_admin"),
    [me]
  );

  // Summary strip — computed from the currently-filtered list.
  // When no filter is applied, this is the full ownership-scoped set.
  const summary = useMemo(() => {
    const total = referrals.length;
    const pending = referrals.filter((r) =>
      PENDING_STATES.includes(r.status as ReferralStatus)
    ).length;
    const completed = referrals.filter((r) => r.status === "completed").length;
    const declined = referrals.filter((r) => r.status === "declined").length;
    return { total, pending, completed, declined };
  }, [referrals]);

  return (
    <div className="flex min-h-screen flex-col bg-background lg:pl-64 print:pl-0">
      <AppNav />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {/* Header */}
          <header className="mb-6 sm:mb-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <Badge
                  variant="outline"
                  className="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300"
                >
                  <Stethoscope className="mr-1 size-3" aria-hidden />
                  Referral lifecycle
                </Badge>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  Referrals
                </h1>
                <p className="max-w-2xl text-sm text-foreground/70">
                  Track referrals from creation to completion.
                  &lsquo;Referral Created&rsquo; &ne; &lsquo;Help Received&rsquo; (§13).
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void load()}
                  className="h-10 min-h-[44px] px-3"
                  aria-label="Refresh referrals"
                >
                  <RefreshCw className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
            <Separator className="mt-6" />
          </header>

          {/* Summary strip */}
          <section
            aria-label="Referral summary"
            className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            <SummaryCard
              label="Total"
              value={summary.total}
              icon={Stethoscope}
              tone="teal"
            />
            <SummaryCard
              label="Pending"
              value={summary.pending}
              icon={Clock}
              tone="amber"
              hint="created → in_progress"
            />
            <SummaryCard
              label="Completed"
              value={summary.completed}
              icon={CheckCircle2}
              tone="emerald"
            />
            <SummaryCard
              label="Declined"
              value={summary.declined}
              icon={XCircle}
              tone="red"
            />
          </section>

          {/* Filter bar */}
          <Card className="mb-4 px-4 py-3 sm:px-6">
            <CardContent className="flex flex-wrap items-center gap-3 px-0">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Filter className="mr-1 inline size-3" aria-hidden />
                  Status
                </p>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as "all" | ReferralStatus)}
                >
                  <SelectTrigger
                    className="h-10 min-h-[44px] w-44"
                    aria-label="Filter by status"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTER_VALUES.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="ml-auto text-xs text-muted-foreground">
                {state === "ready"
                  ? `${referrals.length} referral${referrals.length === 1 ? "" : "s"}${status !== "all" ? ` · ${STATUS_META[status as ReferralStatus]?.label ?? status}` : ""}`
                  : "—"}
              </div>
            </CardContent>
          </Card>

          {/* List */}
          {state === "loading" ? (
            <div className="space-y-3" aria-label="Loading referrals">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-40 w-full rounded-lg" />
              ))}
            </div>
          ) : state === "error" ? (
            <Card className="px-6 py-12 text-center">
              <XCircle className="mx-auto size-8 text-red-600/70" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                Couldn&apos;t load your referrals.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 h-10 min-h-[44px]"
                onClick={() => void load()}
              >
                Retry
              </Button>
            </Card>
          ) : referrals.length === 0 ? (
            <Card className="px-6 py-12 text-center">
              <Stethoscope className="mx-auto size-8 text-muted-foreground/50" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                {status === "all"
                  ? "No referrals yet. A referral is created when an observation is classified as needs-facility-referral or crisis."
                  : `No ${STATUS_META[status as ReferralStatus]?.label ?? status} referrals.`}
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4 h-10 min-h-[44px]">
                <Link href="/">
                  <ArrowLeft className="size-4" aria-hidden />
                  New observation
                </Link>
              </Button>
            </Card>
          ) : (
            <ul className="space-y-3" aria-label="Referral list">
              {referrals.map((r, i) => {
                const statusMeta =
                  STATUS_META[r.status as ReferralStatus] ?? STATUS_META.created;
                const StatusIcon = statusMeta.icon;
                const categoryLabel =
                  CATEGORY_LABELS[r.category] ?? r.category.replace(/_/g, " ");
                return (
                  <motion.li
                    key={r.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(i * 0.04, 0.32) }}
                  >
                    <Card className="overflow-hidden">
                      <CardContent className="space-y-3 p-4 sm:p-5">
                        {/* Row 1: code + status */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn("inline-block size-2 rounded-full", statusMeta.dot)}
                              aria-hidden
                            />
                            <span className="font-mono text-sm font-semibold text-foreground">
                              {r.referralCode}
                            </span>
                          </div>
                          <Badge variant="outline" className={cn("gap-1", statusMeta.tone)}>
                            <StatusIcon className="size-3" aria-hidden />
                            {statusMeta.label}
                          </Badge>
                        </div>

                        {/* Row 2: category + priority */}
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={cn("gap-1", categoryTone(r.category))}>
                            <Stethoscope className="size-3" aria-hidden />
                            {categoryLabel}
                          </Badge>
                          <Badge variant="outline" className={cn("gap-1", priorityTone(r.priority))}>
                            <PriorityIcon priority={r.priority} />
                            <span className="capitalize">{r.priority}</span>
                          </Badge>
                        </div>

                        <Separator />

                        {/* Row 3: identity chain */}
                        <div className="grid gap-2 text-sm sm:grid-cols-2">
                          <div className="flex items-start gap-2">
                            <Home className="mt-0.5 size-3.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
                            <span className="min-w-0">
                              <span className="sr-only">Household: </span>
                              <span className="text-muted-foreground">Household</span>
                              <span className="ml-1.5 text-foreground">{r.householdLabel}</span>
                            </span>
                          </div>
                          <div className="flex items-start gap-2">
                            <User className="mt-0.5 size-3.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
                            <span className="min-w-0">
                              <span className="sr-only">Member: </span>
                              <span className="text-muted-foreground">Member</span>
                              <span className="ml-1.5 text-foreground">{r.memberDisplayName}</span>
                            </span>
                          </div>
                          <div className="flex items-start gap-2 sm:col-span-2">
                            <MapPin className="mt-0.5 size-3.5 shrink-0 text-orange-600 dark:text-orange-400" aria-hidden />
                            <span className="min-w-0">
                              <span className="sr-only">Destination facility: </span>
                              <span className="text-muted-foreground">Destination</span>
                              <span className="ml-1.5 text-foreground">
                                {r.destination ?? "Pending assignment"}
                              </span>
                            </span>
                          </div>
                        </div>

                        <Separator />

                        {/* Row 4: lifecycle timestamps */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" aria-hidden />
                            <span>Created {fmtRelative(r.createdAt)}</span>
                          </span>
                          {r.acknowledgedAt && (
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
                              <span>
                                Acknowledged {fmtRelative(r.acknowledgedAt)}
                                {r.acknowledgedBy ? ` · ${r.acknowledgedBy}` : ""}
                              </span>
                            </span>
                          )}
                          {r.completedAt && (
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
                              <span>Completed {fmtRelative(r.completedAt)}</span>
                            </span>
                          )}
                          {r.followUpRequired && (
                            <span className="inline-flex items-center gap-1">
                              <AlertCircle className="size-3 text-amber-600 dark:text-amber-400" aria-hidden />
                              <span>Follow-up required</span>
                            </span>
                          )}
                        </div>

                        <ReferralStatusAdvance
                          referralId={r.id}
                          status={r.status}
                          canAct={canAct(r)}
                          onUpdated={handleUpdated}
                        />

                        <ReferralHandover referralId={r.id} />
                      </CardContent>
                    </Card>
                  </motion.li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      <footer className="mt-auto border-t bg-background/80 backdrop-blur" role="contentinfo">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            Msaada referrals · Lifecycle tracking (created → completed) · Ownership-scoped (your referrals only)
          </p>
        </div>
      </footer>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: number;
  icon: typeof Stethoscope;
  tone: "teal" | "emerald" | "amber" | "red";
  hint?: string;
}) {
  const toneCls = {
    teal: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300",
    emerald:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    amber:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  }[tone];
  return (
    <Card className={cn("border px-4 py-3", toneCls)}>
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5" aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] opacity-80">{hint}</p>}
    </Card>
  );
}
