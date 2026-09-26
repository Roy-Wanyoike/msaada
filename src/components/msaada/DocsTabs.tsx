"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, AlertCircle, FileText, ArrowLeft, Presentation } from "lucide-react";
import Link from "next/link";
import { AppNav } from "@/components/msaada/AppNav";
import { cn } from "@/lib/utils";

interface DocsTabsProps {
  readme: string;
  problem: string;
  license: string;
}

type Tab = "readme" | "problem" | "license";

const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: "readme", label: "README", icon: BookOpen },
  { id: "problem", label: "Problem", icon: AlertCircle },
  { id: "license", label: "License", icon: FileText },
];

export function DocsTabs({ readme, problem, license }: DocsTabsProps) {
  const [tab, setTab] = useState<Tab>("readme");

  const content = tab === "readme" ? readme : tab === "problem" ? problem : license;

  return (
    <div className="flex min-h-screen flex-col bg-background lg:pl-64">
      <AppNav />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {/* Header */}
          <header className="mb-6">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Back to app
            </Link>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Documentation
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Switch between the README, the problem statement, and the license.
            </p>
          </header>

          {/* Pitch deck card — the presentation lives at /presentation */}
          <Link
            href="/presentation"
            className="group mb-6 flex items-center gap-4 rounded-xl border border-emerald-600/30 bg-emerald-50/60 p-4 transition-colors hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40"
          >
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Presentation className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">
                Presentation — Msaada pitch deck
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                12 slides with speaker notes, keyboard navigation, and a
                downloadable .pptx — open the in-app deck viewer.
              </span>
            </span>
            <Presentation className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>

          {/* Tab bar */}
          <div className="mb-6 flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-pressed={active}
                  className={cn(
                    "relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {t.label}
                  {active && (
                    <motion.span
                      layoutId="docs-tab-active"
                      className="absolute inset-x-2 -bottom-[1px] h-0.5 rounded-full bg-emerald-500"
                      transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Markdown content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="prose prose-sm prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-2xl prose-h1:border-b prose-h1:border-border prose-h1:pb-2 prose-h2:text-xl prose-h2:mt-6 prose-h3:text-lg prose-a:text-emerald-600 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:before:hidden prose-code:after:hidden prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-blockquote:border-l-emerald-500 prose-table:text-sm prose-table:block prose-table:overflow-x-auto prose-table:max-w-full prose-th:border prose-td:border prose-th:bg-muted/50 max-w-none"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <footer className="mt-auto border-t bg-background/80 backdrop-blur" role="contentinfo">
        <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground">
            Msaada · Hackathon MVP · Not a diagnostic tool · MIT License
          </p>
        </div>
      </footer>
    </div>
  );
}
