"use client";

import { useState } from "react";
import { Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Suggestions {
  safetyStep: string | null;
  questions: { sw: string; en: string }[];
  lookFor: string[];
}

const ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: "Suggestions aren't set up on this server yet.",
  RATE_LIMITED: "Too many requests. Try again in a minute.",
  FORBIDDEN: "This follow-up isn't assigned to you.",
};

/** On-demand AI questions for a follow-up visit. Advisory only. */
export function FollowUpSuggestions({ followUpId }: { followUpId: string }) {
  const [data, setData] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/followups/${encodeURIComponent(followUpId)}/suggestions`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as Suggestions & { error?: string };
      if (!res.ok || !Array.isArray(body.questions)) {
        setError((body.error && ERROR_MESSAGES[body.error]) ?? "Couldn't get suggestions. Try again.");
        return;
      }
      setData(body);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return (
      <div className="space-y-1">
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-3.5" aria-hidden />
          )}
          {loading ? "Thinking…" : "Suggest questions for this visit"}
        </Button>
        {error && <p className="text-xs text-muted-foreground" role="status">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2.5">
      {data.safetyStep && (
        <p className="flex gap-1.5 rounded bg-red-50 px-2 py-1.5 text-xs font-medium text-red-800 dark:bg-red-950/40 dark:text-red-200">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {data.safetyStep}
        </p>
      )}
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Sparkles className="size-3.5 text-primary" aria-hidden />
        Questions you could ask
      </p>
      <ol className="list-decimal space-y-1.5 pl-5 text-xs">
        {data.questions.map((q) => (
          <li key={q.sw}>
            <span className="font-medium text-foreground">{q.sw}</span>
            <span className="block text-muted-foreground">{q.en}</span>
          </li>
        ))}
      </ol>
      {data.lookFor.length > 0 && (
        <>
          <p className="text-xs font-semibold text-foreground">Things to notice</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {data.lookFor.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
      <p className="text-[10px] text-muted-foreground">AI suggestion · use your own judgement</p>
    </div>
  );
}
