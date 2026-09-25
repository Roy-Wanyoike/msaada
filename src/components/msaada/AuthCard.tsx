"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Loader2,
  HeartPulse,
  ShieldCheck,
  Phone,
  ArrowRight,
  ArrowLeft,
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
import { LandingPage } from "@/components/msaada/LandingPage";

export interface Chv {
  role?: string;
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

  // ============ HERO VIEW ============ (full landing page — website → webapp)
  if (view === "hero") {
    return (
      <LandingPage
        onLogin={() => setView("login")}
        onSignup={() => setView("signup")}
        onDashboard={onDashboard}
        onDemo={handleDemoAccount}
        demoLoading={demoLoading}
      />
    );
  }

  // ============ LOGIN / SIGNUP TWO-COLUMN VIEW ============
  return (
    <div className="grid min-h-screen w-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Left: form */}
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setView("hero")}
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Back to Msaada home"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-700 text-white">
              <HeartPulse className="size-4" aria-hidden />
            </span>
            <span className="font-semibold text-foreground">Msaada</span>
          </button>
          <button
            type="button"
            onClick={() => setView("hero")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Home
          </button>
        </div>

        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12"
        >
          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {view === "login" ? "Sign in to Msaada" : "Create your account"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {view === "login"
                ? "Log observations, manage households and track follow-ups."
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
                  className="h-11 w-full"
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
                  className="h-11 w-full"
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
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    onClick={() => setView("login")}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
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
                <span className="bg-background px-3 text-xs text-muted-foreground">
                  or
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={handleDemoAccount}
              disabled={demoLoading}
            >
              {demoLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {demoLoading ? "Preparing demo…" : "Use demo account"}
              {!demoLoading && <ArrowRight className="ml-1.5 h-4 w-4" />}
            </Button>
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-center">
              <p className="text-xs font-medium text-muted-foreground">
                Demo credentials
              </p>
              <p className="mt-1 font-mono text-xs text-foreground">
                <span className="select-all">{DEMO_EMAIL}</span>
                <span className="mx-1.5 text-muted-foreground">·</span>
                <span className="select-all">{DEMO_PASSWORD}</span>
              </p>
            </div>
          </div>
        </motion.div>

        <p className="text-xs text-muted-foreground">
          In crisis? Call{" "}
          <a href="tel:1199" className="font-medium text-foreground hover:underline">1199</a>{" "}
          (Kenya Red Cross) or{" "}
          <a href="tel:+254722178177" className="font-medium text-foreground hover:underline">Befrienders Kenya</a>.
        </p>
      </div>

      {/* Right: brand panel (lg+) */}
      <BrandPanel />
    </div>
  );
}

const PANEL_POINTS = [
  { icon: ShieldCheck, title: "Safety rules the AI can't override", text: "Escalation is decided by deterministic, versioned policy." },
  { icon: HeartPulse, title: "A complete identity chain", text: "Household → member → encounter → referral → follow-up." },
  { icon: Phone, title: "Crisis protocol at the doorstep", text: "The crisis line appears the moment an observation needs it." },
];

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-brand-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_top_right,black_20%,transparent_70%)]"
        aria-hidden
      />
      <p className="relative text-sm font-medium text-brand-200">
        Community Health Intelligence · Kenya
      </p>
      <div className="relative max-w-md">
        <h2 className="text-3xl font-semibold leading-tight tracking-tight">
          Every household visit, followed through.
        </h2>
        <p className="mt-4 text-base leading-relaxed text-brand-100/80">
          AI interprets. Deterministic policy controls safety. Authorised
          people control care.
        </p>
        <ul className="mt-10 space-y-6">
          {PANEL_POINTS.map((p) => (
            <li key={p.title} className="flex gap-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                <p.icon className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold">{p.title}</p>
                <p className="mt-0.5 text-sm text-brand-100/70">{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-xs text-brand-100/60">
        Demo build · Not a diagnostic tool · Synthetic data only
      </p>
    </aside>
  );
}
