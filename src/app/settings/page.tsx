"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  User,
  MapPin,
  Mail,
  ShieldCheck,
  Phone,
  AlertTriangle,
  HeartPulse,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "@/components/msaada/AppNav";

interface ChvInfo {
  id: string;
  email: string;
  fullName: string;
  county: string;
  ward: string;
}

type LoadState = "loading" | "ready" | "unauthed";

export default function SettingsPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [chv, setChv] = useState<ChvInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        const data = await res.json();
        if (cancelled) return;
        if (data.chv) {
          setChv(data.chv);
          setState("ready");
        } else {
          setState("unauthed");
        }
      } catch {
        if (!cancelled) setState("unauthed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    window.location.assign("/");
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background lg:pl-64 print:pl-0">
      <AppNav />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <header className="mb-6 sm:mb-8">
            <Badge
              variant="outline"
              className="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300"
            >
              <User className="mr-1 size-3" aria-hidden />
              CHV profile & settings
            </Badge>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Settings
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-foreground/70">
              Your account details and quick-reference safety resources.
            </p>
          </header>

          {state === "loading" ? (
            <div className="space-y-4">
              <Skeleton className="h-40 w-full rounded-lg" />
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          ) : state === "unauthed" || !chv ? (
            <Card className="px-6 py-12 text-center">
              <User className="mx-auto size-8 text-muted-foreground/50" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                Sign in to view your settings.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/">Sign in</Link>
              </Button>
            </Card>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-5"
            >
              {/* Profile card */}
              <Card className="overflow-hidden">
                <div className="relative bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-700 px-6 py-5 text-white">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_55%)]" aria-hidden />
                  <div className="relative flex items-center gap-3">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
                      <HeartPulse className="size-6" aria-hidden />
                    </div>
                    <div>
                      <p className="text-lg font-bold leading-tight">{chv.fullName}</p>
                      <p className="text-xs text-emerald-50/90">Community Health Volunteer</p>
                    </div>
                  </div>
                </div>
                <CardContent className="space-y-3 px-6 py-4">
                  <ProfileRow icon={Mail} label="Email" value={chv.email} mono />
                  <Separator />
                  <ProfileRow icon={MapPin} label="County" value={chv.county} />
                  <Separator />
                  <ProfileRow icon={MapPin} label="Ward" value={chv.ward || "—"} />
                  <Separator />
                  <ProfileRow
                    icon={ShieldCheck}
                    label="Account ID"
                    value={`chv·${chv.id.slice(-4)}`}
                    mono
                    hint="De-identified label used in the audit trail"
                  />
                </CardContent>
              </Card>

              {/* Crisis-line quick reference */}
              <Card className="border-red-200 dark:border-red-900">
                <CardHeader className="flex flex-row items-center gap-2 px-6 pb-3 pt-5">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    <AlertTriangle className="size-4" aria-hidden />
                  </span>
                  <div>
                    <CardTitle className="text-sm font-semibold">Crisis-line quick reference</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      If a household shows acute danger, call immediately.
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 px-6 pb-5">
                  <CrisisLine
                    icon={Phone}
                    label="Kenya Red Cross Emergency"
                    number="1199"
                    note="Toll-free · 24/7"
                  />
                  <CrisisLine
                    icon={Phone}
                    label="Befrienders Kenya"
                    number="+254 722 178 177"
                    note="Emotional support · 24/7"
                  />
                  <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
                    <span className="font-semibold">CHV protocol: </span>
                    Do not leave the household unaccompanied. Contact your CHV
                    supervisor and the nearest Level 4+ facility immediately.
                  </div>
                </CardContent>
              </Card>

              {/* Session actions */}
              <Card className="px-6 py-4">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 px-0">
                  <div>
                    <p className="text-sm font-medium text-foreground">Session</p>
                    <p className="text-xs text-muted-foreground">
                      Sign out to end your session on this device.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => window.location.reload()}
                    >
                      <RefreshCw className="size-3.5" aria-hidden />
                      Refresh
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300"
                      onClick={handleLogout}
                    >
                      <LogOut className="size-3.5" aria-hidden />
                      Sign out
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <p className="px-2 text-center text-[11px] text-muted-foreground">
                Msaada · Not a diagnostic tool · Not a therapist · For triage support only
              </p>
            </motion.div>
          )}
        </div>
      </main>

      <footer className="mt-auto border-t bg-background/80 backdrop-blur" role="contentinfo">
        <div className="mx-auto w-full max-w-2xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            Msaada settings · Profile + crisis-line reference
          </p>
        </div>
      </footer>
    </div>
  );
}

function ProfileRow({
  icon: Icon,
  label,
  value,
  mono,
  hint,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-right">
        <p className={`text-sm text-foreground ${mono ? "font-mono" : "font-medium"}`}>{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function CrisisLine({
  icon: Icon,
  label,
  number,
  note,
}: {
  icon: typeof Phone;
  label: string;
  number: string;
  note: string;
}) {
  return (
    <a
      href={`tel:${number.replace(/\s/g, "")}`}
      className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50/50 px-3 py-2 transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-red-950/20 dark:hover:bg-red-950/40"
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-red-600 text-white">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{note}</p>
      </div>
      <span className="font-mono text-sm font-bold text-red-700 dark:text-red-300">{number}</span>
    </a>
  );
}
