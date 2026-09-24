"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  HeartPulse,
  LayoutDashboard,
  ScrollText,
  Users,
  Stethoscope,
  FileText,
  Settings,
  BookOpen,
  Building2,
  ClipboardList,
  Megaphone,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Unified top-nav bar — shared across the operational routes
 * (/dashboard, /audit, /supervisor, /report/mine) so a judge can move
 * between personas without scrolling to a per-page "Back" button.
 *
 * The CHV submission page (/) is intentionally NOT in the nav — it's the
 * primary user-facing route and has its own header. The nav is for the
 * "back-office" views.
 *
 * Active state is derived from `usePathname()` so it works on both client
 * and server-rendered navigation.
 */

const NAV_ITEMS = [
  { href: "/report", label: "Report", icon: Megaphone },
  { href: "/cases", label: "Cases", icon: ClipboardList },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/households", label: "Households", icon: Users },
  { href: "/referrals", label: "Referrals", icon: Stethoscope },
  { href: "/supervisor", label: "Supervisor", icon: Users },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/admin", label: "Admin", icon: Building2 },
  { href: "/report/mine", label: "My report", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/docs", label: "Docs", icon: BookOpen },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      aria-label="Primary"
    >
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-1 px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-bold text-foreground transition-colors hover:bg-muted/50"
          aria-label="Msaada home"
        >
          <span className="inline-flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
            <HeartPulse className="size-3.5" aria-hidden />
          </span>
          <span className="hidden sm:inline">Msaada</span>
        </Link>

        <div className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />

        {/* Nav items — horizontally scrollable on mobile */}
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                <span>{item.label}</span>
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-x-1 -bottom-[1px] h-0.5 rounded-full bg-emerald-500"
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  />
                )}
              </Link>
            );
          })}
        </div>

        {/* Back to CHV submission (right-aligned) */}
        <Link
          href="/"
          className="ml-auto hidden shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground sm:inline-flex"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          CHV submission
        </Link>
      </div>
    </nav>
  );
}
