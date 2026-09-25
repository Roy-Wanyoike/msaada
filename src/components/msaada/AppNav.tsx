"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HeartPulse,
  LayoutDashboard,
  ScrollText,
  Users,
  UserCog,
  Stethoscope,
  FileText,
  Settings,
  BookOpen,
  Building2,
  ClipboardList,
  Megaphone,
  PenLine,
  Menu,
  LogOut,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Application shell navigation — shared across every signed-in route.
 *
 * Desktop (lg+): fixed 16rem sidebar on the left. Pages that render <AppNav />
 * must offset their content with `lg:pl-64` on their root element.
 * Mobile: sticky top bar with a slide-out sheet holding the same links.
 *
 * Links are grouped by the persona that uses them so the 11 routes stay
 * scannable. Active state uses the longest matching href, so /report/mine
 * doesn't also light up /report.
 */

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Field work",
    items: [
      { href: "/", label: "Record visit", icon: PenLine },
      { href: "/cases", label: "Cases", icon: ClipboardList },
      { href: "/households", label: "Households", icon: Users },
      { href: "/referrals", label: "Referrals", icon: Stethoscope },
      { href: "/report/mine", label: "My weekly report", icon: FileText },
    ],
  },
  {
    label: "Oversight",
    items: [
      { href: "/dashboard", label: "County dashboard", icon: LayoutDashboard },
      { href: "/supervisor", label: "Supervisor", icon: UserCog },
      { href: "/audit", label: "Audit log", icon: ScrollText },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin", label: "Organisation", icon: Building2 },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    label: "Resources",
    items: [
      { href: "/report", label: "Public report form", icon: Megaphone },
      { href: "/docs", label: "Documentation", icon: BookOpen },
    ],
  },
];

const ALL_HREFS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));

function activeHref(pathname: string): string | undefined {
  return ALL_HREFS.filter((href) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/")
  ).sort((a, b) => b.length - a.length)[0];
}

const ROLE_LABELS: Record<string, string> = {
  chv: "Community Health Volunteer",
  cho_supervisor: "CHO Supervisor",
  county_admin: "County Admin",
  subcounty_admin: "Sub-county Admin",
  moh_admin: "Ministry of Health",
  moh_officer: "Ministry of Health",
  program_admin: "Program Admin",
  auditor: "Auditor",
  system_admin: "System Admin",
};

type Me = { fullName: string; role?: string; county?: string | null };

function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((d: { chv: Me | null }) => {
        if (!cancelled) setMe(d.chv);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return me;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore — navigate away regardless
  }
  // Full reload on purpose: drops every page's client-side session state.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/");
}

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Msaada home"
    >
      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <HeartPulse className="size-4" aria-hidden />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Msaada
        </span>
        <span className="mt-1 text-[11px] font-medium text-muted-foreground">
          Community Health
        </span>
      </span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = activeHref(pathname);

  return (
    <nav aria-label="Primary" className="flex flex-col gap-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = item.href === current;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                      aria-hidden
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserCard({ me }: { me: Me | null }) {
  return (
    <div className="space-y-3">
      <a
        href="tel:1199"
        className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
      >
        <Phone className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1">Kenya Red Cross crisis line</span>
        <span className="font-semibold tabular-nums">1199</span>
      </a>
      {me && (
        <div className="flex items-center gap-3 rounded-md px-1">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
            {initials(me.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {me.fullName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {(me.role && ROLE_LABELS[me.role]) ?? "Health worker"}
              {me.county ? ` · ${me.county}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

export function AppNav() {
  const me = useMe();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex print:hidden">
        <div className="flex h-16 shrink-0 items-center px-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks />
        </div>
        <div className="shrink-0 border-t border-sidebar-border p-4">
          <UserCard me={me} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden print:hidden">
        <Brand />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="inline-flex size-10 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Open navigation"
            >
              <Menu className="size-5" aria-hidden />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex h-14 shrink-0 items-center px-5">
              <Brand />
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <div className="shrink-0 border-t border-sidebar-border p-4">
              <UserCard me={me} />
            </div>
          </SheetContent>
        </Sheet>
      </header>
    </>
  );
}
