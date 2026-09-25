"use client";

import { useCallback, useEffect, useState } from "react";
import { AppNav } from "@/components/msaada/AppNav";
import { AuthCard, type Chv } from "@/components/msaada/AuthCard";
import { CrisisPanel } from "@/components/msaada/CrisisPanel";
import { SubmissionForm } from "@/components/msaada/SubmissionForm";
import { MyRecentObservations } from "@/components/msaada/MyRecentObservations";
import { MyImpactCard } from "@/components/msaada/MyImpactCard";
import { PendingFollowUps } from "@/components/msaada/PendingFollowUps";
import { CaseNotifications } from "@/components/msaada/CaseNotifications";
import type { TriageRecordDTO } from "@/lib/types";

type BootState = "loading" | "authed" | "unauthed";

/**
 * `/` — the CHV-facing page.
 *
 * Render priority is fixed by the JSX order:
 *   1. <CrisisPanel>   (only when a triage result has escalation === true)
 *   2. <main>           (AuthCard when unauthed, SubmissionForm when authed)
 *   3. <footer>         (sticky, mt-auto)
 *
 * The crisis panel is `fixed inset-0 z-50` and non-dismissable, so as long
 * as it is the FIRST element in this tree it always takes visual precedence
 * — Escape is blocked in the panel itself, there is no X, and the confirm
 * button is disabled for 5 seconds with a countdown.
 */
export default function Home() {
  const [boot, setBoot] = useState<BootState>("loading");
  const [chv, setChv] = useState<Chv | null>(null);

  // Crisis override state. When non-null, the CrisisPanel renders FIRST in
  // the tree and covers everything else. Cleared only by the explicit
  // confirm button inside the panel (after the 5s countdown).
  const [crisisRecord, setCrisisRecord] = useState<TriageRecordDTO | null>(
    null
  );
  // Set after the CHV confirms the crisis panel — surfaces the
  // "Record logged for reporting" banner above the submission form.
  const [postCrisisBanner, setPostCrisisBanner] = useState<string | null>(
    null
  );
  // Bumped after every successful triage write so the "my recent observations"
  // panel below the form refetches.
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0);

  // --- Session hydration on first paint -------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const data = (await res.json()) as { chv: Chv | null };
        if (cancelled) return;
        if (data.chv) {
          setChv(data.chv);
          setBoot("authed");
        } else {
          setChv(null);
          setBoot("unauthed");
        }
      } catch {
        if (cancelled) return;
        setBoot("unauthed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Handlers passed down to the child components -------------------
  const handleAuthed = useCallback((next: Chv) => {
    setChv(next);
    setBoot("authed");
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore — clear local state regardless
    }
    setChv(null);
    setBoot("unauthed");
    setCrisisRecord(null);
    setPostCrisisBanner(null);
  }, []);

  const handleCrisis = useCallback((record: TriageRecordDTO) => {
    setCrisisRecord(record);
  }, []);

  const handleCrisisConfirm = useCallback(() => {
    if (!crisisRecord) return;
    setPostCrisisBanner(
      `Record logged for reporting · ID ${crisisRecord.id} · ` +
        `${new Date(crisisRecord.createdAt).toLocaleString()}`
    );
    setCrisisRecord(null);
  }, [crisisRecord]);

  const handleClearPostCrisisBanner = useCallback(() => {
    setPostCrisisBanner(null);
  }, []);

  const handleResult = useCallback(() => {
    setRecordsRefreshKey((k) => k + 1);
  }, []);

  // /dashboard is owned by another agent — relative link, never build
  // the route here.
  const openDashboard = useCallback(() => {
    window.location.assign("/dashboard");
  }, []);

  const authed = boot === "authed" && chv !== null;

  return (
    <div
      className={
        authed
          ? "flex min-h-screen flex-col bg-background text-foreground lg:pl-64"
          : "flex min-h-screen flex-col bg-background text-foreground"
      }
    >
      {/* ---------------------------------------------------------- */}
      {/* A. CRISIS PANEL — renders FIRST so it always wins z-index. */}
      {/* Non-dismissable, full-screen, Escape-blocked (see component). */}
      {/* ---------------------------------------------------------- */}
      {crisisRecord?.escalation === true && (
        <CrisisPanel record={crisisRecord} onConfirm={handleCrisisConfirm} />
      )}

      {authed && <AppNav />}

      <main id="main" className="flex flex-1 flex-col">
        {boot === "loading" && <BootSkeleton />}

        {boot === "unauthed" && (
          <AuthCard onAuthed={handleAuthed} onDashboard={openDashboard} />
        )}

        {authed && (
          <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <header className="mb-6 sm:mb-8">
              <p className="text-sm font-medium text-primary">Field work</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Welcome back, {chv.fullName.split(" ")[0]}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Record a household visit, and keep track of the follow-ups
                assigned to you.
              </p>
            </header>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="flex min-w-0 flex-col gap-6">
                <CaseNotifications />
                <SubmissionForm
                  chv={chv}
                  onLogout={handleLogout}
                  onCrisis={handleCrisis}
                  onResult={handleResult}
                  postCrisisBanner={postCrisisBanner}
                  onClearPostCrisisBanner={handleClearPostCrisisBanner}
                />
                <MyRecentObservations refreshKey={recordsRefreshKey} />
              </div>
              <aside className="flex min-w-0 flex-col gap-6">
                <MyImpactCard refreshKey={recordsRefreshKey} />
                <PendingFollowUps refreshKey={recordsRefreshKey} />
              </aside>
            </div>
          </div>
        )}
      </main>

      {authed && (
        <footer className="mt-auto border-t border-border px-4 py-4 text-xs text-muted-foreground sm:px-6 lg:px-8">
          <p className="mx-auto max-w-5xl leading-relaxed">
            Msaada · Demo build · Not a diagnostic tool · Crisis line:{" "}
            <span className="font-medium text-foreground">
              Kenya Red Cross 1199
            </span>{" "}
            /{" "}
            <span className="font-medium text-foreground">
              Befrienders Kenya +254 722 178 177
            </span>
          </p>
        </footer>
      )}
    </div>
  );
}

/** Lightweight skeleton shown while /api/auth/me is in flight. */
function BootSkeleton() {
  return (
    <div
      className="mx-auto mt-24 w-full max-w-md animate-pulse space-y-4 px-4"
      aria-busy="true"
      aria-label="Loading session"
    >
      <div className="mx-auto h-24 w-24 rounded-full bg-muted" />
      <div className="mx-auto h-6 w-40 rounded bg-muted" />
      <div className="h-10 w-full rounded bg-muted" />
      <div className="h-10 w-full rounded bg-muted" />
      <div className="h-11 w-full rounded bg-muted" />
    </div>
  );
}
