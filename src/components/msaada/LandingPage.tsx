"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  HeartPulse,
  ShieldCheck,
  Users,
  Mic,
  Brain,
  Lock,
  Stethoscope,
  ClipboardCheck,
  BarChart3,
  AlertTriangle,
  Eye,
  WifiOff,
  RefreshCw,
  FileSearch,
  Network,
  ArrowRight,
  Phone,
  Building2,
  MapPin,
  Loader2,
  Check,
  Scale,
  UserCheck,
  Sparkles,
  CircleDot,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface LandingPageProps {
  onLogin: () => void;
  onSignup: () => void;
  onDashboard: () => void;
  onDemo: () => void;
  demoLoading: boolean;
}

const FEATURES = [
  { icon: Building2, title: "Institutional onboarding", desc: "MoH and county accounts with invitation-based CHV onboarding, role-based and geographic access controls." },
  { icon: Users, title: "Household traceability", desc: "Structured household records, member profiles, longitudinal encounter history and duplicate detection." },
  { icon: Mic, title: "Voice-first capture", desc: "Observations in Kiswahili, Sheng, English or code-switched speech, instead of long clinical forms." },
  { icon: Brain, title: "AI-assisted extraction", desc: "Observations become structured signals. The AI never diagnoses; it assists the next operational step." },
  { icon: ShieldCheck, title: "Deterministic safety engine", desc: "Versioned, auditable routing rules, kept separate from the model, which cannot override them." },
  { icon: Stethoscope, title: "Referral management", desc: "An 8-state lifecycle from created to completed. A referral created is not the same as help received." },
  { icon: ClipboardCheck, title: "Follow-up tracking", desc: "Who needs follow-up, why, when it is due, who owns it, and what happened when they were reached." },
  { icon: BarChart3, title: "Community intelligence", desc: "Aggregate county and national dashboards: coverage, volumes, follow-up rates and referral completion." },
  { icon: AlertTriangle, title: "Early-warning signals", desc: "Unusual changes surface as signals for human investigation, never as automatic diagnoses." },
  { icon: Eye, title: "Supervisor command center", desc: "Active CHVs, coverage, pending work, overdue referrals and data-quality issues in one view." },
  { icon: Lock, title: "Privacy by design", desc: "PII scrubbed before the model, raw text never stored, de-identified aggregates for managers." },
  { icon: FileSearch, title: "AI transparency", desc: "Every interpretation records the model and policy version, kept apart from the source observation." },
  { icon: RefreshCw, title: "Full audit trail", desc: "Every sensitive action is logged: who, when, from which organisation and under which authorisation." },
  { icon: MapPin, title: "Geographic hierarchy", desc: "County, sub-county, ward, CHU and community. Patterns are shown in aggregate, never as home locations." },
  { icon: WifiOff, title: "Offline-first", desc: "Capture without connectivity and sync securely when back online. On the production roadmap." },
  { icon: Network, title: "Interoperability", desc: "Built to connect with existing health information systems and referral networks, not replace them." },
];

const STEPS = [
  { title: "Capture", desc: "The CHV records what they saw during the household visit, in their own words and language." },
  { title: "Structure", desc: "Personal details are scrubbed, then the model extracts wellbeing, social and environmental signals." },
  { title: "Route", desc: "Fixed, versioned rules decide: routine monitoring, follow-up, facility referral or crisis escalation." },
  { title: "Follow through", desc: "Referrals and follow-ups are tracked to completion, and managers see de-identified trends." },
];

const PRINCIPLES = [
  { icon: Sparkles, title: "AI interprets", desc: "The model turns free text into structured signals. It does not diagnose, and its output is never the final word." },
  { icon: Scale, title: "Rules decide safety", desc: "Escalation is decided by deterministic, versioned policy. A crisis override fires unconditionally." },
  { icon: UserCheck, title: "People control care", desc: "Authorised CHVs, supervisors and facilities act on every case. Every decision is audit-logged." },
];

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-700 text-white">
        <HeartPulse className="size-4" aria-hidden />
      </span>
      <span className="font-semibold text-foreground">Msaada</span>
    </span>
  );
}

/** Illustrative product preview — static markup, not live data. */
function VisitPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 -z-10 rounded-3xl bg-brand-100/60 blur-2xl dark:bg-brand-900/30" aria-hidden />
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-elevated)]">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-brand-500" aria-hidden />
            <span className="text-xs font-medium text-muted-foreground">Example visit · MSD-ENC-4F2K</span>
          </div>
          <span className="text-xs text-muted-foreground">Kilifi · Malindi Town</span>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <p className="text-xs font-medium text-muted-foreground">CHV observation (Kiswahili)</p>
            <p className="mt-1.5 rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-foreground">
              &ldquo;Hajapata usingizi kwa wiki mbili, na hataki kuongea na mtu yeyote nyumbani.&rdquo;
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground">Structured signals</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {["Sleep disturbance", "Social withdrawal", "Duration ≥ 2 weeks"].map((s) => (
                <span key={s} className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground">
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-900/60 dark:bg-amber-950/30">
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Needs follow-up</p>
              <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/70">Revisit within 3 days · assigned to you</p>
            </div>
            <span className="shrink-0 rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-amber-900 dark:bg-black/20 dark:text-amber-200">
              policy v1.0.0
            </span>
          </div>

          <ol className="flex items-center gap-2 text-xs">
            {[
              { label: "Captured", done: true },
              { label: "Routed", done: true },
              { label: "Follow-up", done: false },
            ].map((s, i, arr) => (
              <li key={s.label} className="flex flex-1 items-center gap-2">
                <span
                  className={
                    s.done
                      ? "inline-flex size-5 items-center justify-center rounded-full bg-brand-700 text-white"
                      : "inline-flex size-5 items-center justify-center rounded-full border border-border text-muted-foreground"
                  }
                >
                  {s.done ? <Check className="size-3" aria-hidden /> : <CircleDot className="size-3" aria-hidden />}
                </span>
                <span className={s.done ? "font-medium text-foreground" : "text-muted-foreground"}>{s.label}</span>
                {i < arr.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

export function LandingPage({ onLogin, onSignup, onDashboard, onDemo, demoLoading }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-background">
      {/* ===== NAVBAR ===== */}
      <nav
        className="sticky top-0 z-50 w-full border-b border-border/70 bg-background/85 backdrop-blur-md"
        aria-label="Primary"
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" aria-label="Msaada home">
            <Brand />
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {[
              { href: "#how-it-works", label: "How it works" },
              { href: "#capabilities", label: "Capabilities" },
              { href: "#safety", label: "Safety" },
              { href: "/docs", label: "Docs" },
            ].map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {l.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/report"
              className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              Report a concern
            </Link>
            <Button onClick={onLogin} size="sm" className="h-9 px-4">
              Sign in
            </Button>
          </div>
        </div>
      </nav>

      {/* Page <main> is provided by app/page.tsx */}
      <div>
        {/* ===== HERO ===== */}
        <section className="relative overflow-hidden border-b border-border">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
            aria-hidden
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-8 lg:py-24">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-brand-500" aria-hidden />
                Community Health Intelligence · Kenya
              </span>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-5xl">
                Every household visit,{" "}
                <span className="text-brand-700 dark:text-brand-400">followed through.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
                Msaada connects Community Health Volunteers, health facilities,
                county teams and the Ministry of Health, turning what CHVs
                observe into tracked follow-ups, referrals and de-identified
                community intelligence.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button onClick={onDemo} disabled={demoLoading} size="lg" className="h-11 px-5">
                  {demoLoading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  {demoLoading ? "Preparing demo…" : "Try the demo"}
                  {!demoLoading && <ArrowRight className="size-4" aria-hidden />}
                </Button>
                <Button onClick={onLogin} size="lg" variant="outline" className="h-11 px-5">
                  Sign in
                </Button>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Have an invitation?{" "}
                <button type="button" onClick={onSignup} className="font-medium text-foreground underline-offset-4 hover:underline">
                  Create your account
                </button>
                <span className="mx-2 text-border" aria-hidden>|</span>
                <button type="button" onClick={onDashboard} className="font-medium text-foreground underline-offset-4 hover:underline">
                  View county dashboard
                </button>
              </p>
              <ul className="mt-10 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
                {["De-identified by design", "Deterministic safety rules", "Kiswahili, Sheng, English"].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-brand-600" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
            >
              <VisitPreview />
            </motion.div>
          </div>
        </section>

        {/* ===== PROBLEM ===== */}
        <section className="border-b border-border bg-card">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:gap-16 lg:px-8">
            <div>
              <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">The problem</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                CHVs see the signals first. The system rarely does.
              </h2>
            </div>
            <div className="space-y-4 text-base leading-relaxed text-muted-foreground">
              <p>
                Community Health Volunteers already visit households and notice
                changes in wellbeing, sleep, family circumstances and social
                functioning. But that knowledge lives in notebooks, memory,
                phone calls and WhatsApp threads.
              </p>
              <p>
                The result: people who need follow-up are missed, referrals are
                created but never completed, and county teams make decisions
                without timely community-level intelligence. Msaada closes
                that loop without asking vulnerable people to download yet
                another app.
              </p>
            </div>
          </div>
        </section>

        {/* ===== HOW IT WORKS ===== */}
        <section id="how-it-works" className="scroll-mt-16 border-b border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">How it works</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                From a doorstep conversation to a completed referral
              </h2>
            </div>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="bg-card p-6">
                  <span className="font-mono text-xs font-medium text-muted-foreground">
                    0{i + 1}
                  </span>
                  <h3 className="mt-3 text-base font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ===== CAPABILITIES ===== */}
        <section id="capabilities" className="scroll-mt-16 border-b border-border bg-card">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">Capabilities</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                The full community-health workflow, in one platform
              </h2>
              <p className="mt-3 text-base text-muted-foreground">
                From institutional onboarding to national dashboards, built for
                field conditions and for the people accountable for care.
              </p>
            </div>
            <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <div key={f.title}>
                  <span className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-background text-brand-700 dark:text-brand-400">
                    <f.icon className="size-[18px]" aria-hidden />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-foreground">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== SAFETY MODEL ===== */}
        <section id="safety" className="scroll-mt-16 bg-slate-950 text-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-brand-300">Safety model</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                The model assists. It never decides who gets help.
              </h2>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {PRINCIPLES.map((p) => (
                <div key={p.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
                  <p.icon className="size-5 text-brand-300" aria-hidden />
                  <h3 className="mt-4 text-base font-semibold">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{p.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-10 flex flex-col gap-3 rounded-xl border border-red-400/20 bg-red-500/10 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Phone className="size-5 shrink-0 text-red-300" aria-hidden />
                <p className="text-sm text-slate-200">
                  If someone is in immediate danger, call the Kenya Red Cross
                  crisis line or Befrienders Kenya.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <a href="tel:1199" className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-slate-100">
                  Call 1199
                </a>
                <a href="tel:+254722178177" className="rounded-md border border-white/20 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10">
                  +254 722 178 177
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ===== CTA ===== */}
        <section>
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center lg:px-8">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                See Msaada with real workflows
              </h2>
              <p className="mt-2 max-w-xl text-base text-muted-foreground">
                The demo account is seeded with synthetic households, cases and
                referrals. No real patient data.
              </p>
            </div>
            <div className="flex shrink-0 gap-3">
              <Button onClick={onDemo} disabled={demoLoading} size="lg" className="h-11 px-5">
                {demoLoading ? "Preparing demo…" : "Try the demo"}
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-5">
                <Link href="/report">Report a concern</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-border bg-card" role="contentinfo">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between lg:px-8">
          <div className="max-w-sm">
            <Brand />
            <p className="mt-3 text-sm text-muted-foreground">
              Community Health Intelligence Platform. Hackathon MVP. Not a
              diagnostic tool.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
            <div className="space-y-2">
              <p className="font-medium text-foreground">Product</p>
              <a href="#how-it-works" className="block text-muted-foreground hover:text-foreground">How it works</a>
              <a href="#capabilities" className="block text-muted-foreground hover:text-foreground">Capabilities</a>
              <Link href="/dashboard" className="block text-muted-foreground hover:text-foreground">County dashboard</Link>
            </div>
            <div className="space-y-2">
              <p className="font-medium text-foreground">Resources</p>
              <Link href="/docs" className="block text-muted-foreground hover:text-foreground">Documentation</Link>
              <Link href="/report" className="block text-muted-foreground hover:text-foreground">Report a concern</Link>
            </div>
            <div className="space-y-2">
              <p className="font-medium text-foreground">Crisis support</p>
              <a href="tel:1199" className="block text-muted-foreground hover:text-foreground">Kenya Red Cross · 1199</a>
              <a href="tel:+254722178177" className="block text-muted-foreground hover:text-foreground">Befrienders Kenya</a>
            </div>
          </div>
        </div>
        <div className="border-t border-border">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted-foreground sm:px-6 lg:px-8">
            © Msaada · MIT License
          </p>
        </div>
      </footer>
    </div>
  );
}
