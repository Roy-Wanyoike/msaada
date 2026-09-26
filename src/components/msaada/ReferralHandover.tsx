"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Handover {
  note: string;
  keyPoints: string[];
  model: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: "Handover drafting isn't set up on this server yet.",
  RATE_LIMITED: "Too many requests. Try again in a minute.",
};

/** On-demand Qwen handover note for the receiving facility. Not stored. */
export function ReferralHandover({ referralId }: { referralId: string }) {
  const [data, setData] = useState<Handover | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/referrals/${encodeURIComponent(referralId)}/handover`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as Handover & { error?: string };
      if (!res.ok || !body.note) {
        setError((body.error && ERROR_MESSAGES[body.error]) ?? "Couldn't draft a note. Try again.");
        return;
      }
      setData(body);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!data) return;
    const text = [data.note, ...data.keyPoints.map((k) => `• ${k}`)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Handover note copied");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }

  if (!data) {
    return (
      <div className="space-y-1">
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={draft} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          {loading ? "Drafting…" : "Draft handover note"}
        </Button>
        {error && <p className="text-xs text-muted-foreground">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Sparkles className="size-3.5 text-primary" aria-hidden />
          Handover note for the facility
        </p>
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={copy}>
          <Copy className="size-3.5" aria-hidden />
          Copy
        </Button>
      </div>
      <p className="text-sm leading-relaxed text-foreground">{data.note}</p>
      {data.keyPoints.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground/90">
          {data.keyPoints.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        Drafted by {data.model} · review before sending
      </p>
    </div>
  );
}
