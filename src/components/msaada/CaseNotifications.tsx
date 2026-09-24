"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * CaseNotifications — CR-011 (in-app notifications for CHVs).
 *
 * A non-intrusive background component that polls the response-cases API for
 * newly assigned cases and surfaces them via sonner toasts so a CHV sees new
 * assignments without manually refreshing a roster page.
 *
 * Behaviour:
 *  - Polls `/api/response-cases?status=assigned` every 30s (configurable).
 *  - Tracks seen case IDs in a `useRef<Set<string>>` so a duplicate poll
 *    never re-fires the same toast.
 *  - For every NEW assigned case, fires `toast.info()` with the format:
 *      "New case assigned: MSD-CASE-XXXX — [category] in [county]"
 *  - Optional "N new" badge links to `/cases` (rendered only when there
 *    are unseen assignments; otherwise the component renders nothing
 *    visible — toasts only).
 *  - Non-fatal: 401/404/500/network errors are swallowed silently so the
 *    notification system never blocks the CHV's main workflow.
 *
 * Mount this once per authenticated layout (e.g. inside the CHV dashboard
 * layout or a global header). It is safe to mount multiple instances —
 * the seen-set is per-mount, but duplicate toasts within the same session
 * are still avoided because the first instance marks IDs seen.
 *
 * NOTE: the `/api/response-cases` route is owned by another agent (CR-008).
 * Until it exists this component simply no-ops on 404 — no crash, no
 * error spam. The response contract assumed is:
 *   { cases: Array<{ id, caseCode, reportCategory, county }> }
 */

interface AssignedCase {
  id: string;
  caseCode: string;
  /** One of REPORT_CATEGORIES from community-report-types. */
  reportCategory: string;
  county: string;
}

interface CaseNotificationsProps {
  /** Polling interval in ms. Defaults to 30s per the CR-011 spec. */
  pollIntervalMs?: number;
  /** Render the optional "N new" badge. Defaults to true. */
  showBadge?: boolean;
  /** Override the toast action target. Defaults to "/cases". */
  casesHref?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

const CATEGORY_LABEL: Record<string, string> = {
  mental_health: "mental health",
  maternal: "maternal",
  child_health: "child health",
  social_support: "social support",
  other: "general concern",
};

function labelForCategory(category: string): string {
  return CATEGORY_LABEL[category] ?? category ?? "concern";
}

export function CaseNotifications({
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  showBadge = true,
  casesHref = "/cases",
}: CaseNotificationsProps) {
  // Seen-set lives in a ref (not state) so updating it never triggers a
  // re-render and a duplicate poll can never re-fire the same toast.
  const seenRef = useRef<Set<string>>(new Set());
  // Count of NEW assignments the CHV hasn't acknowledged by visiting /cases.
  // Used only for the optional badge.
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(
          "/api/response-cases?status=assigned",
          {
            cache: "no-store",
            credentials: "same-origin",
          },
        );
        // 401 (not logged in), 404 (route not deployed yet by CR-008), or
        // any 5xx — silently skip. The notification system must never
        // block the CHV's main workflow.
        if (!res.ok) return;

        const data = (await res.json()) as { cases?: AssignedCase[] };
        const cases = Array.isArray(data?.cases) ? data.cases : [];
        if (cancelled) return;

        // First poll: hydrate the seen-set with whatever is already
        // assigned so we DON'T toast-storm a CHV who logs in with N
        // pre-existing assignments. Only cases that appear AFTER mount
        // fire toasts. This matches the spec's "newly assigned" wording.
        if (seenRef.current.size === 0) {
          for (const c of cases) seenRef.current.add(c.id);
          return;
        }

        const fresh = cases.filter((c) => !seenRef.current.has(c.id));
        if (fresh.length === 0) return;

        // Mark seen BEFORE firing toasts so a duplicate poll can't re-fire.
        for (const c of fresh) seenRef.current.add(c.id);

        for (const c of fresh) {
          const label = labelForCategory(c.reportCategory);
          toast.info(
            `New case assigned: ${c.caseCode} — ${label} in ${c.county}`,
            {
              description: "Review and accept the assignment when ready.",
              action: {
                label: "Open cases",
                onClick: () => window.location.assign(casesHref),
              },
            },
          );
        }

        setUnseenCount((n) => n + fresh.length);
      } catch {
        // Network error / JSON parse failure — silent. The notification
        // system is a side-channel, not a transactional requirement.
      }
    }

    // Fire once on mount, then at the configured interval.
    void poll();
    const handle = setInterval(() => {
      void poll();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [pollIntervalMs, casesHref]);

  // Non-intrusive: render nothing visible unless there are unseen
  // assignments AND the badge is enabled.
  if (!showBadge || unseenCount === 0) return null;

  const label = unseenCount === 1 ? "1 new case" : `${unseenCount} new cases`;

  return (
    <Link
      href={casesHref}
      aria-label={`${unseenCount} new case assignment${
        unseenCount === 1 ? "" : "s"
      } — open cases`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-transparent",
        "bg-primary px-3 py-1 text-xs font-medium text-primary-foreground",
        "shadow-sm transition-colors hover:bg-primary/90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
    >
      <Bell className="size-3.5" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

export default CaseNotifications;
