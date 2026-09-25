"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  RefreshCw,
  Building2,
  Users,
  Send,
  Copy,
  Check,
  Clock,
  XCircle,
  UserPlus,
  ShieldCheck,
  HeartPulse,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "@/components/msaada/AppNav";
import { cn } from "@/lib/utils";

interface Chv {
  id: string;
  email: string;
  fullName: string;
  county: string;
  ward: string;
  role: string;
}

interface Invitation {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  token: string;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  organization: { name: string } | null;
}

type LoadState = "loading" | "ready" | "unauthed" | "forbidden";

const ROLES = [
  { value: "chv", label: "CHV / Community Health Volunteer" },
  { value: "cho_supervisor", label: "Supervisor / CHO" },
  { value: "subcounty_admin", label: "Sub-county Admin" },
  { value: "program_admin", label: "Program / Partner Admin" },
];

const STATUS_STYLES: Record<string, { tone: string; icon: typeof Clock }> = {
  pending: { tone: "border-amber-200 bg-amber-50 text-amber-700", icon: Clock },
  accepted: { tone: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: Check },
  expired: { tone: "border-red-200 bg-red-50 text-red-700", icon: XCircle },
  revoked: { tone: "border-muted bg-muted/40 text-muted-foreground", icon: XCircle },
};

export default function AdminPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [chv, setChv] = useState<Chv | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [showForm, setShowForm] = useState(false);

  // form state
  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invRole, setInvRole] = useState("chv");
  const [invLoading, setInvLoading] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const meRes = await fetch("/api/auth/me", { credentials: "same-origin" });
      const me = await meRes.json();
      if (!me.chv) {
        setState("unauthed");
        return;
      }
      setChv(me.chv);
      // Check role — only institutional roles can access this page.
      if (!["county_admin", "cho_supervisor", "moh_admin", "system_admin"].includes(me.chv.role ?? "chv")) {
        setState("forbidden");
        return;
      }
      // Fetch invitations.
      const invRes = await fetch("/api/invitations", { credentials: "same-origin" });
      if (invRes.ok) {
        const invData = await invRes.json();
        setInvitations(invData.invitations ?? []);
      }
      setState("ready");
    } catch {
      setState("unauthed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInvLoading(true);
    setCreatedLink(null);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: invEmail, fullName: invName, role: invRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Invitation failed", {
          description: data.error === "USER_EXISTS"
            ? "A user with that email already exists."
            : data.error === "INVITATION_EXISTS"
              ? "A pending invitation already exists."
              : data.error ?? "Please try again.",
        });
        return;
      }
      toast.success("Invitation created", {
        description: `Invite link generated for ${data.email}`,
      });
      setCreatedLink(data.inviteLink);
      setInvEmail("");
      setInvName("");
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setInvLoading(false);
    }
  }

  function copyLink(link: string) {
    const full = `${window.location.origin}${link}`;
    navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link copied", { description: full });
  }

  const pendingCount = invitations.filter((i) => i.status === "pending").length;
  const acceptedCount = invitations.filter((i) => i.status === "accepted").length;

  return (
    <div className="flex min-h-screen flex-col bg-background lg:pl-64 print:pl-0">
      <AppNav />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {state === "loading" ? (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-64 w-full rounded-lg" />
            </div>
          ) : state === "unauthed" ? (
            <Card className="px-6 py-12 text-center">
              <ShieldCheck className="mx-auto size-8 text-muted-foreground/50" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                Sign in to access the admin panel.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/">Sign in</Link>
              </Button>
            </Card>
          ) : state === "forbidden" ? (
            <Card className="px-6 py-12 text-center">
              <XCircle className="mx-auto size-8 text-red-500/50" aria-hidden />
              <p className="mt-3 text-sm font-medium text-foreground">Access denied</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Only County Admins, Supervisors, and MoH officers can access this page.
                Your role: <span className="font-mono">{chv?.role ?? "chv"}</span>
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Demo: log in as <span className="font-mono">county.admin@msaada.health</span> / <span className="font-mono">msaada123</span>
              </p>
            </Card>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-5"
            >
              {/* Header */}
              <header>
                <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
                  <Building2 className="mr-1 size-3" aria-hidden />
                  County Admin · Institution-led onboarding
                </Badge>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  Onboarding & invitations
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Invite CHVs and supervisors to your organization. Invitation-based
                  onboarding — no self-signup (§3, §10).
                </p>
              </header>

              {/* Summary KPIs */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="border-border/40 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total invitations</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{invitations.length}</p>
                </Card>
                <Card className="border-amber-200 bg-amber-50/50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Pending</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-amber-700">{pendingCount}</p>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50/50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Accepted</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{acceptedCount}</p>
                </Card>
              </div>

              {/* Invite button */}
              <Button
                onClick={() => setShowForm((v) => !v)}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                <UserPlus className="mr-2 size-4" />
                {showForm ? "Cancel" : "Invite a CHV / Officer"}
              </Button>

              {/* Invite form */}
              <AnimatePresence>
                {showForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <Card className="px-6 py-5">
                      <CardHeader className="px-0 pb-3">
                        <CardTitle className="text-sm font-semibold">New invitation</CardTitle>
                      </CardHeader>
                      <CardContent className="px-0 space-y-4">
                        <form onSubmit={handleInvite} className="space-y-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="inv-email">Email address</Label>
                            <Input
                              id="inv-email"
                              type="email"
                              required
                              placeholder="new.chv@msaada.health"
                              value={invEmail}
                              onChange={(e) => setInvEmail(e.target.value)}
                              className="min-h-11"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="inv-name">Full name (optional)</Label>
                            <Input
                              id="inv-name"
                              type="text"
                              placeholder="Wanjiru Kamau"
                              value={invName}
                              onChange={(e) => setInvName(e.target.value)}
                              className="min-h-11"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Role</Label>
                            <Select value={invRole} onValueChange={setInvRole}>
                              <SelectTrigger className="min-h-11 w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLES.map((r) => (
                                  <SelectItem key={r.value} value={r.value}>
                                    {r.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            type="submit"
                            className="h-11 w-full bg-emerald-600 hover:bg-emerald-700"
                            disabled={invLoading}
                          >
                            {invLoading ? "Creating…" : "Create invitation"}
                            <Send className="ml-2 size-4" />
                          </Button>
                        </form>
                        {createdLink && (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4"
                          >
                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                              Invitation link
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <code className="flex-1 truncate rounded-md bg-background px-2 py-1.5 text-xs text-foreground">
                                {window.location.origin}{createdLink}
                              </code>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                onClick={() => copyLink(createdLink)}
                              >
                                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                              </Button>
                            </div>
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              Share this link with the invitee. They&apos;ll set their
                              password and be onboarded as <span className="font-medium">{invRole}</span>.
                            </p>
                          </motion.div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Invitations list */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Sent invitations
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => void load()}
                    aria-label="Refresh"
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                </div>
                {invitations.length === 0 ? (
                  <Card className="px-6 py-8 text-center">
                    <Send className="mx-auto size-6 text-muted-foreground/50" aria-hidden />
                    <p className="mt-2 text-sm text-muted-foreground">
                      No invitations sent yet. Use the button above to invite a CHV.
                    </p>
                  </Card>
                ) : (
                  <ul className="space-y-2">
                    {invitations.map((inv) => {
                      const st = STATUS_STYLES[inv.status] ?? STATUS_STYLES.pending;
                      const Icon = st.icon;
                      return (
                        <li key={inv.id}>
                          <Card className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-md border", st.tone)}>
                                <Icon className="size-4" aria-hidden />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">
                                    {inv.fullName ?? inv.email}
                                  </span>
                                  <Badge variant="outline" className="h-5 px-1.5 py-0 text-[10px] font-semibold uppercase">
                                    {inv.role}
                                  </Badge>
                                </div>
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {inv.email}
                                  {inv.organization ? ` · ${inv.organization.name}` : ""}
                                </p>
                              </div>
                              <div className="text-right">
                                <Badge variant="outline" className={cn("h-5 px-1.5 py-0 text-[10px] font-semibold uppercase", st.tone)}>
                                  {inv.status}
                                </Badge>
                                {inv.status === "pending" && (
                                  <button
                                    onClick={() => copyLink(`/?invite=${inv.token}`)}
                                    className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-700 hover:underline"
                                  >
                                    <Copy className="size-2.5" /> Copy link
                                  </button>
                                )}
                              </div>
                            </div>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Onboarding state machine reference */}
              <Card className="border-border/40 px-6 py-4">
                <CardHeader className="px-0 pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Onboarding state machine (§10)
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    {["Invited", "Verification", "Verified", "Credentials", "Device", "Active"].map((s, i, arr) => (
                      <span key={s} className="inline-flex items-center gap-1.5">
                        <span className={cn(
                          "rounded px-1.5 py-0.5 font-medium",
                          s === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                        )}>{s}</span>
                        {i < arr.length - 1 && <span className="text-muted-foreground/50">→</span>}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    The demo skips verification + device steps. Production requires identity
                    verification + device binding before ACTIVE (§3, §5).
                  </p>
                </CardContent>
              </Card>

              {/* Demo credentials hint */}
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2.5 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  County Admin demo
                </p>
                <p className="mt-1 font-mono text-xs text-foreground">
                  county.admin@msaada.health · msaada123
                </p>
              </div>
            </motion.div>
          )}
        </div>
      </main>

      <footer className="mt-auto border-t bg-background/80 backdrop-blur" role="contentinfo">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground">
            Msaada · Institution-led onboarding · Invitation-based, not self-signup
          </p>
        </div>
      </footer>
    </div>
  );
}
