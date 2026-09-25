"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize,
  Minimize,
  StickyNote,
} from "lucide-react";
import { AppNav } from "@/components/msaada/AppNav";
import { cn } from "@/lib/utils";

export interface SlideMeta {
  /** Public URL of the slide HTML file (e.g. /slides/slide_01.html). */
  src: string;
  /** Slide title extracted from the HTML <title> (fallback: "Slide N"). */
  title: string;
  /** Speaker notes extracted from the slide's hidden <aside data-notes>. */
  notes: string | null;
}

interface SlideViewerProps {
  slides: SlideMeta[];
}

const DECK_W = 1280;
const DECK_H = 720;

/**
 * Full-deck viewer for the Msaada pitch presentation (used by /presentation).
 *
 * Each slide is a self-contained 1280×720 HTML file rendered in an iframe.
 * The iframe is rendered at its native size and CSS-transform-scaled to fit
 * the available width (ResizeObserver), so the deck stays pixel-accurate at
 * any viewport — the same technique presentation tools use to embed fixed
 * canvas slides.
 *
 * Presenter affordances:
 *  - ← / → / Space / Home / End keyboard navigation
 *  - prev/next controls, slide counter, clickable progress dots
 *  - speaker-notes panel (notes were authored per slide as hidden asides)
 *  - browser fullscreen toggle (wrapper element, so controls stay reachable)
 *  - download link for the original .pptx
 */
export function SlideViewer({ slides }: SlideViewerProps) {
  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const total = slides.length;
  const current = slides[index] ?? slides[0];

  const go = useCallback(
    (next: number) => {
      if (total === 0) return;
      setIndex(((next % total) + total) % total);
    },
    [total]
  );

  // --- Scale the fixed 1280×720 deck to the measured container width ------
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / DECK_W);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen]);

  // --- Keyboard navigation -------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case "ArrowRight":
        case " ":
        case "PageDown":
          e.preventDefault();
          go(index + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          go(index - 1);
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(total - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, total, go]);

  // --- Fullscreen tracking ---------------------------------------------------
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen().catch(() => {
        // denied/unsupported — controls still work in-page
      });
    }
  }, []);

  if (total === 0) {
    return (
      <div className="flex min-h-screen flex-col bg-background lg:pl-64">
        <AppNav />
        <main className="flex flex-1 items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">
            No slides found. Expected <code>/public/slides/slide_01.html … slide_12.html</code>.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background lg:pl-64">
      <AppNav />

      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {/* Header */}
          <header className="mb-6">
            <Link
              href="/docs"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Back to documentation
            </Link>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Presentation — Msaada pitch deck
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              12 slides · Use ← / → or the buttons below · Toggle the notes panel
              for speaker cues ·{" "}
              <a
                href="/presentation/Msaada-Pitch-Deck.pptx"
                download
                className="font-medium text-emerald-600 underline-offset-2 hover:underline"
              >
                Download .pptx
              </a>
            </p>
          </header>

          {/* Deck stage — fixed-canvas slide scaled to fit */}
          <div
            ref={wrapperRef}
            className="overflow-hidden rounded-xl border border-border bg-muted/30 shadow-sm"
          >
            <div
              ref={stageRef}
              className="relative w-full"
              style={{ height: DECK_H * scale }}
              role="region"
              aria-roledescription="carousel"
              aria-label="Msaada pitch deck"
            >
              <iframe
                key={current.src}
                src={current.src}
                title={`${current.title} (${index + 1} of ${total})`}
                className="absolute left-0 top-0 origin-top-left border-0 bg-white"
                style={{ width: DECK_W, height: DECK_H, transform: `scale(${scale})` }}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => go(index - 1)}
                disabled={index === 0}
                aria-label="Previous slide"
                className="inline-flex h-10 items-center gap-1 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-4" aria-hidden />
                Prev
              </button>
              <button
                type="button"
                onClick={() => go(index + 1)}
                disabled={index === total - 1}
                aria-label="Next slide"
                className="inline-flex h-10 items-center gap-1 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <ChevronRight className="size-4" aria-hidden />
              </button>
              <span
                className="ml-1 text-sm tabular-nums text-muted-foreground"
                aria-live="polite"
              >
                {index + 1} / {total}
              </span>
            </div>

            <p className="hidden min-w-0 flex-1 truncate px-2 text-sm font-medium text-foreground sm:block">
              {current.title}
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowNotes((v) => !v)}
                aria-pressed={showNotes}
                aria-label={showNotes ? "Hide speaker notes" : "Show speaker notes"}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
                  showNotes
                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                    : "border-border bg-background text-foreground hover:bg-muted"
                )}
              >
                <StickyNote className="size-4" aria-hidden />
                Notes
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {isFullscreen ? (
                  <Minimize className="size-4" aria-hidden />
                ) : (
                  <Maximize className="size-4" aria-hidden />
                )}
                {isFullscreen ? "Exit" : "Fullscreen"}
              </button>
            </div>
          </div>

          {/* Progress dots */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.src}
                type="button"
                onClick={() => go(i)}
                aria-label={`Go to slide ${i + 1}: ${s.title}`}
                aria-current={i === index}
                className={cn(
                  "h-2.5 rounded-full transition-all",
                  i === index
                    ? "w-6 bg-emerald-600"
                    : "w-2.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                )}
              />
            ))}
          </div>

          {/* Speaker notes */}
          {showNotes && (
            <aside
              aria-label="Speaker notes"
              className="mt-4 rounded-xl border border-border bg-muted/30 p-4"
            >
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <StickyNote className="size-3.5" aria-hidden />
                Speaker notes · slide {index + 1}
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                {current.notes?.trim() ||
                  "No speaker notes for this slide — talk through the visuals."}
              </p>
            </aside>
          )}

          {/* Slide index list */}
          <nav aria-label="All slides" className="mt-8">
            <h2 className="mb-2 text-sm font-semibold text-foreground">All slides</h2>
            <ol className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {slides.map((s, i) => (
                <li key={s.src}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      i === index
                        ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                        : "border-border bg-background text-foreground hover:bg-muted"
                    )}
                  >
                    <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Download className="size-3.5" aria-hidden />
            Presenting offline? The original{" "}
            <a
              href="/presentation/Msaada-Pitch-Deck.pptx"
              download
              className="font-medium text-emerald-600 underline-offset-2 hover:underline"
            >
              Msaada-Pitch-Deck.pptx
            </a>{" "}
            opens in PowerPoint / Google Slides.
          </p>
        </div>
      </main>

      <footer className="mt-auto border-t bg-background/80 backdrop-blur" role="contentinfo">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-muted-foreground">
            Msaada · Hackathon MVP · Not a diagnostic tool · MIT License
          </p>
        </div>
      </footer>
    </div>
  );
}
