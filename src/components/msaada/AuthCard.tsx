"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Loader2,
  LogIn,
  UserPlus,
  HeartPulse,
  ExternalLink,
  ShieldCheck,
  Phone,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Stethoscope,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { COUNTIES, WARDS, type County } from "@/lib/types";

export interface Chv {
  id: string;
  email: string;
  fullName: string;
  county: string;
  ward: string;
}

interface AuthCardProps {
  onAuthed: (chv: Chv) => void;
  onDashboard: () => void;
}

const DEMO_EMAIL = "demo@msaada.health";
const DEMO_PASSWORD = "msaada123";

type View = "hero" | "login" | "signup";

export function AuthCard({ onAuthed, onDashboard }: AuthCardProps) {
  const [view, setView] = useState<View>("hero");

  // login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // signup state
  const [suName, setSuName] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [suCounty, setSuCounty] = useState<County | "">("");
  const [suWard, setSuWard] = useState<string>("");
  const [suLoading, setSuLoading] = useState(false);

  const [demoLoading, setDemoLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error("Login failed", {
          description:
            data.error === "INVALID_CREDENTIALS"
              ? "Email or password is incorrect."
              : "Please try again.",
        });
        return;
      }
      toast.success("Welcome back", { description: data.chv.fullName });
      onAuthed(data.chv as Chv);
    } catch {
      toast.error("Network error", {
        description: "Could not reach the server. Try again.",
      });
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!suCounty) {
      toast.error("Select a county");
      return;
    }
    if (!suWard) {
      toast.error("Select a ward");
      return;
    }
    setSuLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: suEmail,
          password: suPassword,
          fullName: suName,
          county: suCounty,
          ward: suWard,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error("Sign-up failed", {
          description:
            data.error === "EMAIL_EXISTS"
              ? "That email is already registered. Log in instead."
              : "Please try again.",
        });
        return;
      }
      toast.success("Account created", { description: data.chv.fullName });
      onAuthed(data.chv as Chv);
    } catch {
      toast.error("Network error");
    } finally {
      setSuLoading(false);
    }
  }

  async function handleDemoAccount() {
    setDemoLoading(true);
    try {
      await fetch("/api/demo-chv", { method: "POST" });
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error("Demo login failed", { description: data.error });
        return;
      }
      toast.success("Signed in with the demo account");
      onAuthed(data.chv as Chv);
    } catch {
      toast.error("Network error");
    } finally {
      setDemoLoading(false);
    }
  }

  // ============ PROJECT INFO PANEL (shared by login + signup views) ============
  const ProjectInfoPanel = () => (
    <div className="relative flex flex-col justify-between bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-900 p-8 text-white sm:p-10">
      {/* Decorative pattern */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, white 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, white 1px, transparent 1.5px)",
          backgroundSize: "60px 60px, 50px 50px",
        }}
        aria-hidden
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_55%)]" aria-hidden />

      {/* Brand */}
      <div className="relative">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2.5"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
            <HeartPulse className="size-5" aria-hidden />
          </span>
          <span className="text-xl font-bold tracking-tight">Msaada</span>
        </motion.div>
      </div>

      {/* Tagline + principles */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="relative space-y-5"
      >
        <div>
          <h2 className="text-2xl font-bold leading-tight sm:text-3xl">
            Community health,
            <br />
            intelligently coordinated.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-emerald-50/80">
            AI interprets. Deterministic policy controls safety.
            <br />
            Authorized humans control care.
          </p>
        </div>

        <div className="space-y-2.5">
          {[
            { icon: ShieldCheck, text: "Deterministic policy engine — AI can't override safety" },
            { icon: HeartPulse, text: "Identity chain: Household → Member → Encounter" },
            { icon: Phone, text: "Crisis-line protocol fires at point of observation" },
          ].map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.1 }}
              className="flex items-center gap-2.5"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/15">
                <item.icon className="size-3.5" aria-hidden />
              </span>
              <span className="text-xs text-emerald-50/90">{item.text}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Crisis line */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="relative rounded-xl border border-white/15 bg-white/5 p-4 backdrop-blur"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-100/70">
          Crisis line
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <a href="tel:1199" className="flex items-center gap-1.5 text-sm font-bold text-white transition-colors hover:text-emerald-100">
            <Phone className="size-3.5" aria-hidden />
            1199
          </a>
          <span className="text-emerald-200/30" aria-hidden>|</span>
          <a href="tel:+254722178177" className="text-xs text-emerald-50/80 transition-colors hover:text-white">
            Befrienders Kenya
          </a>
        </div>
      </motion.div>
    </div>
  );

  // ============ HERO VIEW ============
  if (view === "hero") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="flex w-full max-w-3xl flex-col items-center text-center"
      >
        {/* Brand */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6 flex items-center gap-3"
        >
          <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-950/20">
            <HeartPulse className="size-7" aria-hidden />
          </span>
          <h1 className="text-4xl font-bold tracking-tight">Msaada</h1>
        </motion.div>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-2 text-lg text-foreground"
        >
          Community health, intelligently coordinated.
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="mb-8 max-w-md text-sm text-muted-foreground"
        >
          AI interprets. Deterministic policy controls safety. Authorized
          humans control care. A triage-support tool for Community Health
          Volunteers in Kenya.
        </motion.p>

        {/* CTA buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex w-full max-w-sm flex-col gap-3"
        >
          <Button
            onClick={() => setView("login")}
            className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
          >
            <LogIn className="mr-2 size-5" />
            Login
            <ArrowRight className="ml-2 size-4" />
          </Button>
          <Button
            onClick={() => setView("signup")}
            variant="outline"
            className="h-12 w-full border-emerald-300 text-base text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400 dark:border-emerald-800 dark:text-emerald-300"
          >
            <UserPlus className="mr-2 size-5" />
            Sign up
          </Button>
        </motion.div>

        {/* Demo + dashboard */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-6 flex w-full max-w-sm flex-col gap-3"
        >
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                or
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            className="h-10 w-full text-sm text-muted-foreground hover:text-foreground"
            onClick={handleDemoAccount}
            disabled={demoLoading}
          >
            {demoLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
            {demoLoading ? "Preparing demo…" : "Use demo account"}
          </Button>
          <button
            onClick={onDashboard}
            className="flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-800 dark:text-emerald-300"
          >
            View county dashboard <ExternalLink className="size-3.5" />
          </button>
        </motion.div>
      </motion.div>
    );
  }

  // ============ LOGIN / SIGNUP TWO-COLUMN VIEW ============
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className="flex w-full max-w-4xl overflow-hidden rounded-2xl border border-border/60 shadow-2xl shadow-emerald-950/10"
    >
      {/* Left: project info (hidden on mobile, shown on lg+) */}
      <div className="hidden lg:block lg:w-1/2">
        <ProjectInfoPanel />
      </div>

      {/* Right: form */}
      <div className="flex w-full flex-col justify-center bg-background p-6 sm:p-10 lg:w-1/2">
        {/* Back button */}
        <button
          onClick={() => setView("hero")}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </button>

        {/* Mobile brand (shows on < lg) */}
        <div className="mb-6 flex items-center gap-2 lg:hidden">
          <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
            <HeartPulse className="size-4" aria-hidden />
          </span>
          <span className="text-lg font-bold">Msaada</span>
        </div>

        {/* Heading */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {view === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {view === "login"
              ? "Sign in to log observations and manage your households."
              : "Register as a Community Health Volunteer."}
          </p>
        </div>

        {/* Login form */}
        <AnimatePresence mode="wait">
          {view === "login" && (
            <motion.form
              key="login"
              onSubmit={handleLogin}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@msaada.health"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="min-h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="min-h-11"
                />
              </div>
              <Button
                type="submit"
                className="h-11 w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={loginLoading}
              >
                {loginLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loginLoading ? "Signing in…" : "Sign in"}
                {!loginLoading && <ArrowRight className="ml-1.5 h-4 w-4" />}
              </Button>
            </motion.form>
          )}

          {view === "signup" && (
            <motion.form
              key="signup"
              onSubmit={handleSignup}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="su-name">Full name</Label>
                <Input
                  id="su-name"
                  type="text"
                  required
                  autoComplete="name"
                  placeholder="Wanjiru Kamau"
                  value={suName}
                  onChange={(e) => setSuName(e.target.value)}
                  className="min-h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="su-email">Email</Label>
                <Input
                  id="su-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@msaada.health"
                  value={suEmail}
                  onChange={(e) => setSuEmail(e.target.value)}
                  className="min-h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="su-password">Password</Label>
                <Input
                  id="su-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={suPassword}
                  onChange={(e) => setSuPassword(e.target.value)}
                  className="min-h-11"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="su-county">County</Label>
                  <Select
                    value={suCounty}
                    onValueChange={(v) => {
                      setSuCounty(v as County);
                      setSuWard("");
                    }}
                  >
                    <SelectTrigger id="su-county" className="min-h-11 w-full">
                      <SelectValue placeholder="Select county" />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-ward">Ward</Label>
                  <Select
                    value={suWard}
                    onValueChange={setSuWard}
                    disabled={!suCounty}
                  >
                    <SelectTrigger id="su-ward" className="min-h-11 w-full">
                      <SelectValue placeholder="Select ward" />
                    </SelectTrigger>
                    <SelectContent>
                      {(suCounty ? WARDS[suCounty] : []).map((w) => (
                        <SelectItem key={w} value={w}>
                          {w}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                type="submit"
                className="h-11 w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={suLoading}
              >
                {suLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {suLoading ? "Creating account…" : "Create account"}
                {!suLoading && <ArrowRight className="ml-1.5 h-4 w-4" />}
              </Button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Switch between login/signup + demo */}
        <div className="mt-6 space-y-3">
          <p className="text-center text-sm text-muted-foreground">
            {view === "login" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  onClick={() => setView("signup")}
                  className="font-medium text-emerald-600 hover:underline"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => setView("login")}
                  className="font-medium text-emerald-600 hover:underline"
                >
                  Login
                </button>
              </>
            )}
          </p>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                or
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            className="h-11 w-full border-emerald-300 bg-emerald-50/40 text-emerald-700 transition-colors hover:bg-emerald-50 hover:border-emerald-400 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
            onClick={handleDemoAccount}
            disabled={demoLoading}
          >
            {demoLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {demoLoading ? "Preparing demo…" : "Use demo account"}
            {!demoLoading && <ArrowRight className="ml-1.5 h-4 w-4" />}
          </Button>
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2.5 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Demo credentials
            </p>
            <p className="mt-1 font-mono text-xs text-foreground">
              <span className="select-all">{DEMO_EMAIL}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span className="select-all">{DEMO_PASSWORD}</span>
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
