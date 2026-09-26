"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const REFRESH_INTERVAL_MS = 30_000;

/**
 * Auto-refresh for /status. The page is a server component that re-runs the
 * probes on every request, so router.refresh() is all it takes to get fresh
 * results — no HTTP self-call to /api/health.
 */
export function StatusRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      // Don't burn server probes for a tab nobody is looking at.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      startTransition(() => router.refresh());
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, router]);

  const refreshNow = () => startTransition(() => router.refresh());

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={refreshNow}
        disabled={pending}
      >
        <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden />
        Refresh
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 text-muted-foreground"
        onClick={() => setAutoRefresh((v) => !v)}
        aria-pressed={autoRefresh}
        title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
      >
        {autoRefresh ? "Auto: 30 s" : "Auto: off"}
      </Button>
    </div>
  );
}
