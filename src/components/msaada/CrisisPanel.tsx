"use client";

import { useEffect, useState, useCallback } from "react";
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
 *  - That button is disabled for the first 5 seconds with a countdown to
 *    prevent accidental dismissal in a panic.
 *  - After confirmation the parent clears the crisis state and shows a
 *    follow-up message that the record was logged for reporting.
 */
export function CrisisPanel({
  record,
  onConfirm,
}: {
  record: TriageRecordDTO;
  onConfirm: () => void;
}) {
  const [countdown, setCountdown] = useState(5);
  const canConfirm = countdown === 0;

  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(
      () => setCountdown((c) => Math.max(0, c - 1)),
      1000
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

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm();
  }, [canConfirm, onConfirm]);

  return (
    <motion.div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="crisis-title"
      aria-describedby="crisis-desc"
      aria-live="assertive"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-red-600 text-white px-4 py-6"
      onMouseDown={(e) => e.stopPropagation()}
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
            {record.crisisLine ??
              "Kenya Red Cross 1199 · Befrienders Kenya +254 722 178 177"}
          </p>
          <ul className="mt-3 space-y-1 text-sm font-medium text-white/90">
            <li>Kenya Red Cross toll-free: <span className="font-bold">1199</span></li>
            <li>Befrienders Kenya: <span className="font-bold">+254 722 178 177</span></li>
          </ul>
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-lg bg-red-800/60 p-3 text-sm font-semibold text-white">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>Do NOT leave the household unaccompanied.</p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="h-12 w-full rounded-xl bg-white text-base font-bold text-red-700 hover:bg-white/90 disabled:opacity-70 disabled:cursor-not-allowed"
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
          Record logged for reporting · ID <span className="font-mono">{record.id}</span>
        </p>
      </motion.div>
    </motion.div>
  );
}
