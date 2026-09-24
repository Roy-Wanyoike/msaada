"use client";

import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Database, RefreshCw, TriangleAlert } from "lucide-react";

/** Full-screen skeleton for first load. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="gap-0 px-4 py-4 sm:px-5 sm:py-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-12" />
            <Skeleton className="mt-2 h-3 w-16" />
          </Card>
        ))}
      </div>
      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="px-4 py-4 sm:px-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-1 h-3 w-60" />
            <Skeleton className="mt-4 h-[300px] w-full" />
          </Card>
        ))}
      </div>
      {/* Table */}
      <Card className="px-4 py-4 sm:px-6">
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}

interface EmptyStateProps {
  onSeed: () => void;
  seeding: boolean;
}

export function EmptyState({ onSeed, seeding }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-12 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400">
          <Database className="size-6" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="text-lg font-semibold">No triage records yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Once CHVs start submitting home-visit observations, this dashboard
            will populate with aggregate county / daily / tag charts. You can
            seed demo data to see how it looks.
          </p>
        </div>
        <Button
          size="lg"
          onClick={onSeed}
          disabled={seeding}
          className="mt-2 h-11 min-w-[180px] bg-teal-600 text-white hover:bg-teal-700"
        >
          {seeding ? (
            <>
              <RefreshCw className="size-4 animate-spin" aria-hidden />
              Seeding…
            </>
          ) : (
            <>
              <Database className="size-4" aria-hidden />
              Seed demo data
            </>
          )}
        </Button>
      </Card>
    </motion.div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <Card className="flex flex-col items-center gap-3 border-red-200 bg-red-50 px-6 py-10 text-center dark:border-red-900 dark:bg-red-950/30">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-lg font-semibold">Couldn&apos;t load dashboard</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      <Button
        variant="outline"
        size="lg"
        onClick={onRetry}
        className="mt-2 h-11 min-w-[180px]"
      >
        <RefreshCw className="size-4" aria-hidden />
        Try again
      </Button>
    </Card>
  );
}

/** Inline banner shown when the dataset is empty (idempotent seed prompt). */
export function SeedPromptBanner({
  onSeed,
  seeding,
}: {
  onSeed: () => void;
  seeding: boolean;
}) {
  return (
    <Card className="flex flex-col items-start justify-between gap-3 border-teal-200 bg-teal-50 px-4 py-3 sm:flex-row sm:items-center dark:border-teal-900 dark:bg-teal-950/40">
      <p className="text-sm text-teal-800 dark:text-teal-300">
        No triage records yet. Seed demo data to populate the dashboard.
      </p>
      <Button
        size="sm"
        onClick={onSeed}
        disabled={seeding}
        className="bg-teal-600 text-white hover:bg-teal-700"
      >
        {seeding ? (
          <>
            <RefreshCw className="size-4 animate-spin" aria-hidden />
            Seeding…
          </>
        ) : (
          <>
            <Database className="size-4" aria-hidden />
            Seed demo data →
          </>
        )}
      </Button>
    </Card>
  );
}
