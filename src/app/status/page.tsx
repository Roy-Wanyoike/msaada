import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  Cloud,
  Database,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  runHealthChecks,
  type CheckStatus,
  type Checks,
} from "@/lib/health";
import { StatusRefresh } from "./StatusRefresh";

// The probes run on every request — never pre-render or cache the page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "System status — Msaada",
  description:
    "Live health of Msaada's database, Qwen AI and Supabase integrations. Status words only — no configuration details are exposed.",
};

/* ------------------------------------------------------------------------ */
/* Presentation maps — green = ok, amber = not configured, red = error.      */
/* "Not configured" must stay visibly distinct from "down" (issue #17).      */
/* ------------------------------------------------------------------------ */

type Tone = {
  label: string;
  icon: LucideIcon;
  pill: string;
  iconWrap: string;
};

const TONES: Record<CheckStatus, Tone> = {
  ok: {
    label: "Operational",
    icon: CheckCircle2,
    pill:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    iconWrap:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  not_configured: {
    label: "Not configured",
    icon: CircleSlash,
    pill:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    iconWrap:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  error: {
    label: "Down",
    icon: XCircle,
    pill:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
    iconWrap:
      "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  },
};

type ProbeDef = {
  key: keyof Checks;
  name: string;
  role: string;
  /** Honest, non-sensitive explanation per outcome. */
  copy: Record<CheckStatus, string>;
};

const PROBES: ProbeDef[] = [
  {
    key: "database",
    name: "Database",
    role: "Prisma / SQLite — observations, cases, audit trail",
    copy: {
      ok: "Answered a SELECT 1 probe within the 3 s timeout.",
      // Structurally unreachable (the probe always runs) — listed so the
      // copy map stays exhaustive over CheckStatus.
      not_configured: "Not applicable for the database probe.",
      error:
        "The probe failed or timed out. Details are written to the server logs only — never shown here.",
    },
  },
  {
    key: "qwen",
    name: "Qwen AI",
    role: "Triage classification — config presence check, no model call",
    copy: {
      ok: "API key is present. Classification runs on demand — this check never calls the model.",
      not_configured:
        "No API key is set in this environment. AI triage falls back to the deterministic policy engine, so the app keeps working.",
      // Structurally unreachable (no network call is made).
      error: "Not applicable for this check.",
    },
  },
  {
    key: "supabase",
    name: "Supabase",
    role: "Optional auth + sync integration",
    copy: {
      ok: "Auth health endpoint responded 2xx within the 3 s timeout.",
      not_configured:
        "Optional integration not set up in this environment. This is not an outage — Msaada's own auth and database work without it.",
      error:
        "Health endpoint unreachable or returned a non-2xx response. Details are in the server logs only.",
    },
  },
];

/** Deterministic UTC display for the probe timestamp — no locale/TZ drift. */
function formatTimestamp(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export default async function StatusPage() {
  const report = await runHealthChecks();

  const anyError = Object.values(report.checks).includes("error");
  const anyNotConfigured = Object.values(report.checks).includes(
    "not_configured"
  );

  // Banner tone: green only when everything is ok; red when a probe actually
  // failed; amber when the degradation is merely configuration absence.
  const banner = anyError
    ? {
        wrap: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
        icon: XCircle,
        iconWrap:
          "bg-red-600 text-white dark:bg-red-900 dark:text-red-100",
        title: "Degraded — a probe failed",
        body: "At least one probe returned an error. Nothing sensitive is exposed on this page; check the server logs.",
      }
    : anyNotConfigured
      ? {
          wrap:
            "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
          icon: CircleSlash,
          iconWrap:
            "bg-amber-500 text-white dark:bg-amber-900 dark:text-amber-100",
          title: "Degraded — configuration incomplete",
          body: "One or more optional integrations are not configured. That is different from an outage: the cards below say which.",
        }
      : {
          wrap:
            "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
          icon: CheckCircle2,
          iconWrap:
            "bg-emerald-600 text-white dark:bg-emerald-900 dark:text-emerald-100",
          title: "All systems operational",
          body: "All three probes passed. Results are re-computed on every page load.",
        };
  const BannerIcon = banner.icon;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-3 sm:mb-8">
            <div>
              <Badge
                variant="outline"
                className="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300"
              >
                <Activity className="mr-1 size-3" aria-hidden />
                System health
              </Badge>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Status
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-foreground/70">
                Live health of Msaada&apos;s three integrations. Probes run
                server-side on every load and report status words only — no
                configuration values are shown.
              </p>
            </div>
            <StatusRefresh />
          </header>

          {/* Overall banner */}
          <section
            aria-live="polite"
            aria-label="Overall system status"
            className={cn(
              "flex items-start gap-3 rounded-lg border px-4 py-4 sm:px-5",
              banner.wrap
            )}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                banner.iconWrap
              )}
            >
              <BannerIcon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground sm:text-base">
                {banner.title}
              </p>
              <p className="mt-0.5 text-xs text-foreground/70 sm:text-sm">
                {banner.body}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                Probed at {formatTimestamp(report.timestamp)} · v{report.version}
              </p>
            </div>
          </section>

          {/* Session-secret mode (informational, MVP-41) — login works in all
              three modes; "ephemeral" means sessions reset on restart. */}
          {report.sessionSecret === "ephemeral" && (
            <section
              aria-label="Session mode"
              className="mt-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Login is running in ephemeral-session mode
                </p>
                <p className="mt-0.5 text-xs text-foreground/70 sm:text-sm">
                  Authentication works right now, but sessions reset whenever
                  the server restarts. Set the MSAADA_SESSION_SECRET
                  environment variable (any random string of 32+ characters)
                  for sessions that survive restarts.
                </p>
              </div>
            </section>
          )}

          {/* Per-probe cards */}
          <div className="mt-5 grid gap-4 sm:grid-cols-3" role="list">
            {PROBES.map((probe) => {
              const status = report.checks[probe.key];
              const tone = TONES[status];
              const ToneIcon = tone.icon;
              const ProbeIcon =
                probe.key === "database"
                  ? Database
                  : probe.key === "qwen"
                    ? Sparkles
                    : Cloud;
              return (
                <Card key={probe.key} role="listitem" className="flex flex-col">
                  <CardHeader className="flex flex-row items-center gap-3 px-5 pb-2 pt-5">
                    <span
                      className={cn(
                        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                        tone.iconWrap
                      )}
                    >
                      <ProbeIcon className="size-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-semibold">
                        {probe.name}
                      </CardTitle>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        {probe.role}
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-2 px-5 pb-5">
                    <Badge
                      variant="outline"
                      className={cn("w-fit gap-1", tone.pill)}
                    >
                      <ToneIcon className="size-3" aria-hidden />
                      {tone.label}
                    </Badge>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {probe.copy[status]}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* JSON endpoint + back link */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href="/">
                <ArrowLeft className="size-3.5" aria-hidden />
                Back to Msaada
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">
              Machine-readable version:{" "}
              <Link
                href="/api/health"
                className="font-mono text-foreground/80 underline-offset-2 hover:underline"
              >
                GET /api/health
              </Link>
            </p>
          </div>

          <p className="mt-8 px-2 text-center text-[11px] text-muted-foreground">
            Msaada · Not a diagnostic tool · Status probes expose no secrets,
            keys or connection details
          </p>
        </div>
      </main>
    </div>
  );
}
