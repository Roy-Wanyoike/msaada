"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, LogIn, UserPlus, Sparkles, ExternalLink } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

export function AuthCard({ onAuthed, onDashboard }: AuthCardProps) {
  const [tab, setTab] = useState<"login" | "signup">("login");

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
          description: data.error === "INVALID_CREDENTIALS"
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
          description: data.error === "EMAIL_EXISTS"
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
      // ensure the demo CHV exists (creates if missing)
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="w-full max-w-md"
    >
      <Card className="overflow-hidden border-border/60 shadow-xl shadow-emerald-950/5">
        {/* Gradient header band */}
        <div className="relative bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-700 px-6 py-7 text-center text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_55%)]" aria-hidden />
          <div className="relative">
            <div className="mx-auto mb-2.5 flex size-12 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
              <Sparkles className="size-6" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Msaada</h1>
            <p className="mt-0.5 text-xs font-medium text-emerald-50/90">
              Community Health Volunteer · mental-health triage
            </p>
          </div>
        </div>
        <CardContent className="pt-5">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" className="min-h-11">
                <LogIn className="mr-1.5 h-4 w-4" /> Login
              </TabsTrigger>
              <TabsTrigger value="signup" className="min-h-11">
                <UserPlus className="mr-1.5 h-4 w-4" /> Sign up
              </TabsTrigger>
            </TabsList>

            {/* ---------- LOGIN ---------- */}
            <TabsContent value="login" className="mt-4">
              <form onSubmit={handleLogin} className="space-y-4">
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
                </Button>
              </form>
            </TabsContent>

            {/* ---------- SIGNUP ---------- */}
            <TabsContent value="signup" className="mt-4">
              <form onSubmit={handleSignup} className="space-y-4">
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
                    <Label>County</Label>
                    <Select
                      value={suCounty}
                      onValueChange={(v) => {
                        setSuCounty(v as County);
                        setSuWard("");
                      }}
                    >
                      <SelectTrigger className="min-h-11 w-full">
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
                    <Label>Ward</Label>
                    <Select
                      value={suWard}
                      onValueChange={setSuWard}
                      disabled={!suCounty}
                    >
                      <SelectTrigger className="min-h-11 w-full">
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
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="mt-5 space-y-3">
            <Separator />
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full border-emerald-300 bg-emerald-50/40 text-emerald-700 transition-colors hover:bg-emerald-50 hover:border-emerald-400 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
              onClick={handleDemoAccount}
              disabled={demoLoading}
            >
              {demoLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {demoLoading ? "Preparing demo…" : "Use demo account"}
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
            <button
              type="button"
              onClick={onDashboard}
              className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            >
              View county dashboard <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
