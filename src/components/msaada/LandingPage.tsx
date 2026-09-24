"use client";

import { useState, useEffect } from "react";
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
  LogIn,
  UserPlus,
  Phone,
  ExternalLink,
  Building2,
  MapPin,
  BookOpen,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
interface LandingPageProps {
  onLogin: () => void;
  onSignup: () => void;
  onDashboard: () => void;
  onDemo: () => void;
  demoLoading: boolean;
}

const FEATURES = [
  { icon: Building2, title: "Institutional onboarding", desc: "MoH and county accounts. Invitation-based CHV onboarding — no self-signup. Role-based + geographic access controls." },
  { icon: Users, title: "Household traceability", desc: "Structured household records, individual member profiles, longitudinal encounter history, duplicate detection." },
  { icon: Mic, title: "Voice-first data collection", desc: "CHVs record observations in Kiswahili, Sheng, English, or code-switched language — no clinical forms." },
  { icon: Brain, title: "AI-assisted extraction", desc: "Qwen structures observations into WHO-aligned signals. The AI does NOT diagnose — it assists the next operational step." },
  { icon: ShieldCheck, title: "Deterministic safety engine", desc: "Critical decisions separated from the AI. Versioned, auditable rules. The AI cannot override configured safety rules." },
  { icon: Stethoscope, title: "Referral management", desc: "Create, route, track, acknowledge, complete. 8-state lifecycle. 'Referral Created' ≠ 'Help Received.'" },
  { icon: ClipboardCheck, title: "Follow-up management", desc: "Who needs follow-up, why, when it's due, who's responsible, whether the person was reached, what happened." },
  { icon: BarChart3, title: "Community intelligence", desc: "Aggregate dashboards for county + MoH. Coverage, volumes, follow-up rates, referral completion, trends." },
  { icon: AlertTriangle, title: "Early-warning signals", desc: "Unusual changes in community signals — presented as signals requiring human investigation, not diagnoses." },
  { icon: Eye, title: "Supervisor command center", desc: "Monitor active CHVs, coverage, pending encounters, follow-ups, referrals, data quality, emerging signals." },
  { icon: WifiOff, title: "Offline-first (target)", desc: "Capture offline, store securely, sync automatically when connected. Retries, duplicate prevention, conflict resolution." },
  { icon: Lock, title: "Privacy & security", desc: "Role-based access, encryption, audit logging, minimum-data principle, de-identification for dashboards." },
  { icon: FileSearch, title: "AI transparency", desc: "Records which model/version generated each interpretation. Source observation kept separate from AI interpretation." },
  { icon: Network, title: "Future interoperability", desc: "Designed to connect with existing health systems, referral networks, and benefits-navigation services." },
  { icon: RefreshCw, title: "Audit trail", desc: "Every sensitive action auditable: who accessed what, when, from which org, under which authorization." },
  { icon: MapPin, title: "Geographic intelligence", desc: "County → Sub-county → Ward → CHU → Community. Dashboards show aggregate patterns, not individual locations." },
];

export function LandingPage({ onLogin, onSignup, onDashboard, onDemo, demoLoading }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* ===== STICKY NAVBAR (transparent on hero, solid on scroll) ===== */}
      <nav
        className={cn(
          "fixed top-0 z-50 w-full transition-all duration-300",
          scrolled
            ? "border-b border-border/60 bg-background/90 backdrop-blur-md"
            : "border-b border-transparent bg-transparent"
        )}
        aria-label="Primary"
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2" aria-label="Msaada home">
            <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
              <HeartPulse className="size-4" aria-hidden />
            </span>
            <span className={cn("font-bold", scrolled ? "text-foreground" : "text-white")}>
              Msaada
            </span>
          </Link>
          {/* Nav links */}
          <div className="hidden items-center gap-1 sm:flex">
            <Link
              href="/docs"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                scrolled ? "text-muted-foreground hover:text-foreground hover:bg-muted/40" : "text-white/80 hover:text-white"
              )}
            >
              <BookOpen className="size-3.5" aria-hidden />
              Docs
            </Link>
            <Link
              href="/report"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                scrolled ? "text-muted-foreground hover:text-foreground hover:bg-muted/40" : "text-white/80 hover:text-white"
              )}
            >
              Report
            </Link>
            <Link
              href="/dashboard"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                scrolled ? "text-muted-foreground hover:text-foreground hover:bg-muted/40" : "text-white/80 hover:text-white"
              )}
            >
              <LayoutDashboard className="size-3.5" aria-hidden />
              Dashboard
            </Link>
          </div>
          {/* Login button */}
          <Button
            onClick={onLogin}
            size="sm"
            className={cn(
              "h-9 transition-all",
              scrolled
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-white/15 text-white backdrop-blur ring-1 ring-white/25 hover:bg-white/25"
            )}
          >
            <LogIn className="mr-1.5 size-3.5" />
            Login
          </Button>
        </div>
      </nav>

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, white 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, white 1px, transparent 1.5px)",
            backgroundSize: "60px 60px, 50px 50px",
          }}
        />

        <div className="relative mx-auto flex min-h-[90vh] max-w-5xl flex-col items-center justify-center px-4 py-16 text-center text-white sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-3"
          >
            <span className="flex size-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
              <HeartPulse className="size-7" aria-hidden />
            </span>
            <h1 className="text-5xl font-bold tracking-tight">Msaada</h1>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-4 max-w-2xl text-lg font-medium leading-relaxed text-emerald-50"
          >
            AI-powered, offline-first Community Health Intelligence Platform
            strengthening the connection between CHVs, households, health
            facilities, county health teams, and the Ministry of Health.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-2 text-sm text-emerald-100/70"
          >
            AI interprets. Deterministic policy controls safety. Authorized humans control care.
          </motion.p>

          {/* CTA buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            <Button
              onClick={onLogin}
              size="lg"
              className="h-12 bg-white text-emerald-700 hover:bg-emerald-50"
            >
              <LogIn className="mr-2 size-5" />
              Login
              <ArrowRight className="ml-2 size-4" />
            </Button>
            <Button
              onClick={onSignup}
              size="lg"
              variant="outline"
              className="h-12 border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/20"
            >
              <UserPlus className="mr-2 size-5" />
              Sign up
            </Button>
          </motion.div>

          {/* Secondary actions */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-6 flex flex-col items-center gap-2 text-sm text-emerald-100/80 sm:flex-row sm:gap-4"
          >
            <button
              onClick={onDemo}
              disabled={demoLoading}
              className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
            >
              {demoLoading ? "Preparing…" : "Use demo account"}
            </button>
            <span className="hidden sm:inline text-emerald-200/30">·</span>
            <button
              onClick={onDashboard}
              className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
            >
              View county dashboard <ExternalLink className="size-3.5" />
            </button>
          </motion.div>

          {/* Crisis line */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-8 flex items-center gap-3 rounded-lg border border-white/15 bg-white/5 px-4 py-2 backdrop-blur"
          >
            <Phone className="size-4 text-emerald-100" aria-hidden />
            <span className="text-xs text-emerald-100/70">Crisis line:</span>
            <a href="tel:1199" className="text-sm font-bold text-white hover:text-emerald-100">1199</a>
            <span className="text-emerald-200/30">·</span>
            <a href="tel:+254722178177" className="text-xs text-emerald-100/80 hover:text-white">Befrienders Kenya</a>
          </motion.div>
        </div>
      </section>

      {/* ===== WHAT IS MSAADA ===== */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.3 }}
        >
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            What is Msaada?
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            CHVs are already present in communities and often observe important
            health and social signals, but information can remain fragmented
            across notebooks, memory, phone calls, WhatsApp messages, and
            disconnected reporting systems. This makes it difficult to identify
            people who need follow-up, track referrals, understand
            community-level trends, and give health managers timely
            intelligence.
          </p>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Msaada creates a complete digital workflow:
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
            {["Institution", "CHO", "Supervisor", "CHV", "Household", "Person", "Encounter", "Referral", "Follow-up", "Intelligence"].map((s, i, arr) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  {s}
                </Badge>
                {i < arr.length - 1 && <ArrowRight className="size-3 text-muted-foreground" />}
              </span>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ===== KEY FEATURES ===== */}
      <section className="bg-muted/30 py-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3 }}
          >
            <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Key Features
            </h2>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              15 capabilities covering the full community-health workflow.
            </p>
          </motion.div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.4) }}
                className="rounded-xl border border-border/60 bg-background p-5 transition-shadow hover:shadow-md"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <f.icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-3 text-sm font-semibold text-foreground">{f.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== WHAT MAKES US DIFFERENT ===== */}
      <section className="relative overflow-hidden py-16">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-900" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.1),transparent_55%)]" />

        <div className="relative mx-auto max-w-3xl px-4 text-center text-white sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3 }}
          >
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              What makes Msaada different
            </h2>
            <p className="mt-4 text-base leading-relaxed text-emerald-50/90">
              We are not asking vulnerable people to download another chatbot.
              We are strengthening the <span className="font-semibold">existing community health network</span>.
            </p>
            <p className="mt-3 text-base leading-relaxed text-emerald-50/90">
              A CHV already visits households. Msaada gives that CHV better
              tools to capture information, operate offline, identify when
              follow-up is needed, coordinate referrals, and ensure that
              important community signals reach the people responsible for
              public-health decisions.
            </p>
            <p className="mt-3 text-sm italic text-emerald-100/70">
              Mental health is our initial use case, but the underlying
              infrastructure can become a broader Community Health Intelligence
              Layer for Kenya and other African health systems.
            </p>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center"
          >
            <Button
              onClick={onLogin}
              size="lg"
              className="h-12 bg-white text-emerald-700 hover:bg-emerald-50"
            >
              <LogIn className="mr-2 size-5" />
              Login
            </Button>
            <Button
              onClick={onSignup}
              size="lg"
              variant="outline"
              className="h-12 border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/20"
            >
              <UserPlus className="mr-2 size-5" />
              Sign up
            </Button>
          </motion.div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="border-t bg-background py-8" role="contentinfo">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 text-center sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
              <HeartPulse className="size-3.5" aria-hidden />
            </span>
            <span className="text-sm font-bold">Msaada</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Community Health Intelligence Platform · Hackathon MVP · Not a diagnostic tool · MIT License
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Crisis line:</span>
            <a href="tel:1199" className="font-medium text-foreground hover:text-emerald-600">1199</a>
            <span>·</span>
            <a href="tel:+254722178177" className="hover:text-foreground">Befrienders Kenya</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
