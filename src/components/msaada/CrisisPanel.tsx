"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Phone, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TriageRecordDTO } from "@/lib/types";

/**
 * Non-dismissable, full-screen crisis override panel.
 *
 * Behaviour:
 *  - Renders as the FIRST element in the tree (`fixed inset-0 z-50`), so it
 *    always takes visual precedence over the submission form.
 *  - Cannot be closed by Escape, has no X button, cannot auto-dismiss.
 *  - The ONLY way out is the explicit confirm button
 *    "I have read this and will act now".
 *  - That button is gated for the first 5 seconds with a countdown to
 *    prevent accidental dismissal in a panic. During the countdown the
 *    button stays keyboard-focusable (via `aria-disabled`, NOT the native
 *    `disabled` attribute) so keyboard/screen-reader users are not trapped.
 *  - After confirmation the parent clears the crisis state and shows a
 *    follow-up message that the record was logged for reporting.
 *  - While mounted: focus is moved into the dialog and trapped (Tab /
 *    Shift+Tab cannot escape to the covered form); a `beforeunload` handler
 *    blocks browser refresh / close / URL navigation; focus is restored to
 *    the trigger element on unmount.
 */

/** Shared styling for the `tel:` anchors — high-contrast, tappable, focus ring. */
const TEL_LINK_CLASS =
  "font-bold underline decoration-white/80 decoration-2 underline-offset-2 hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-red-700 rounded-sm";

/** Returns the focusable descendants of `root`, in DOM order, excluding hidden. */
function getFocusableDescendants(root: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "textarea:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
}

export function CrisisPanel({
  record,
  onConfirm,
}: {
  record: TriageRecordDTO;
  onConfirm: () => void;
}) {
  const [countdown, setCountdown] = useState(5);
  const canConfirm = countdown === 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  // Element that had focus before the panel mounted — restored on unmount.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 5-second countdown to prevent panic-dismissal.
  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(
      () => setCountdown((c) => Math.max(0, c - 1)),
      1000,
    );
    return () => window.clearTimeout(t);
  }, [countdown]);

  // Block Escape (and any key that might close a parent dialog). We stop
  // propagation in the capture phase so nothing above us can intercept.
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, []);

  // Focus management — required by the WAI-ARIA alertdialog pattern:
  // move focus into the dialog on mount, trap Tab/Shift+Tab, and restore
  // focus to the trigger element on unmount.
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Use rAF so the motion.div is committed to the DOM before we focus.
    const raf = window.requestAnimationFrame(() => {
      // The confirm button stays focusable during the countdown (we use
      // `aria-disabled`, not native `disabled`), so we can land on it
      // immediately — it is the primary action the CHV must take.
      const target =
        confirmButtonRef.current ?? containerRef.current ?? null;
      if (target) {
        target.focus();
      }
    });

    return () => {
      window.cancelAnimationFrame(raf);
      const trigger = previousFocusRef.current;
      if (trigger && typeof trigger.focus === "function") {
        trigger.focus();
      }
    };
  }, []);

  // Block browser refresh / close / URL navigation while the panel is
  // mounted. The spec's "the ONLY way out is the explicit confirm button"
  // claim is now enforced against the most common panic reaction (F5 /
  // back button). Modern browsers show a generic "Leave site?" prompt and
  // ignore the returned string.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const handleConfirm = useCallback(() => {
    // Guard: clicks / Enter / Space during the countdown are no-ops, but
    // the button stays focusable for keyboard users (aria-disabled, not
    // native disabled).
    if (!canConfirm) return;
    onConfirm();
  }, [canConfirm, onConfirm]);

  // Trap Tab / Shift+Tab inside the dialog so focus cannot escape to the
  // submission form beneath the `fixed inset-0 z-50` overlay.
  const handleTrapKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;

      const focusables = getFocusableDescendants(container);
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift+Tab on the first focusable → wrap to last.
        // Also wrap if focus somehow escaped the container.
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab on the last focusable → wrap to first.
        if (active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [],
  );

  return (
    <motion.div
      ref={containerRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="crisis-title"
      aria-describedby="crisis-desc"
      aria-live="assertive"
      // `-1` so the container itself can receive focus as a fallback (e.g.
      // when the focusables list is empty / focus escapes the trap).
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-red-600 text-white px-4 py-6 outline-none"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={handleTrapKeyDown}
    >
      <motion.div
        initial={{ y: -8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="w-full max-w-2xl rounded-2xl border-4 border-white/70 bg-red-700 shadow-2xl p-6 sm:p-8"
      >
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15">
            <AlertTriangle className="h-7 w-7 text-white" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-white/80">
              Msaada Crisis Override
            </p>
            <h2
              id="crisis-title"
              className="text-3xl sm:text-4xl font-black leading-tight tracking-tight"
            >
              CRISIS OVERRIDE
            </h2>
          </div>
        </div>

        <p
          id="crisis-desc"
          className="mt-5 text-base sm:text-lg font-semibold leading-relaxed text-white"
        >
          {record.chpInstruction ??
            "Immediate danger detected. Escalate to the crisis line and stay with the household."}
        </p>

        <div className="mt-5 rounded-xl border-2 border-white/80 bg-white/10 p-4 sm:p-5">
          <div className="flex items-center gap-2 text-white/90">
            <Phone className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-bold uppercase tracking-wider">
              Crisis line — call now
            </span>
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-black tracking-tight text-white">
            {record.crisisLine ?? (
              <>
                Kenya Red Cross{" "}
                <a href="tel:1199" className={TEL_LINK_CLASS}>
                  1199
                </a>
                {" · "}
                Befrienders Kenya{" "}
                <a href="tel:+254722178177" className={TEL_LINK_CLASS}>
                  +254 722 178 177
                </a>
              </>
            )}
          </p>
          <ul className="mt-3 space-y-1 text-sm font-medium text-white/90">
            <li>
              Kenya Red Cross toll-free:{" "}
              <a href="tel:1199" className={TEL_LINK_CLASS}>
                <span className="font-bold">1199</span>
              </a>
            </li>
            <li>
              Befrienders Kenya:{" "}
              <a href="tel:+254722178177" className={TEL_LINK_CLASS}>
                <span className="font-bold">+254 722 178 177</span>
              </a>
            </li>
          </ul>
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-lg bg-red-800/60 p-3 text-sm font-semibold text-white">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>Do NOT leave the household unaccompanied.</p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <Button
            ref={confirmButtonRef}
            type="button"
            onClick={handleConfirm}
            // Use `aria-disabled` instead of the native `disabled` attribute
            // so the button stays in the tab order during the 5-second
            // countdown — keyboard / screen-reader users are not trapped.
            // `handleConfirm` early-returns while `!canConfirm`.
            aria-disabled={canConfirm ? undefined : true}
            tabIndex={0}
            className="h-12 w-full rounded-xl bg-white text-base font-bold text-red-700 hover:bg-white/90 aria-disabled:opacity-70 aria-disabled:cursor-not-allowed"
          >
            {canConfirm
              ? "I have read this and will act now"
              : `Wait ${countdown}s…`}
          </Button>
          <p className="text-center text-xs text-white/80">
            This panel cannot be closed without confirmation.
          </p>
        </div>

        <p className="mt-4 border-t border-white/30 pt-3 text-center text-xs text-white/70">
          Record logged for reporting · ID{" "}
          <span className="font-mono">{record.id}</span>
        </p>
      </motion.div>
    </motion.div>
  );
}
