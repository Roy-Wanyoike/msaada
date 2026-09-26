"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Inbox, Loader2, MapPin, Sparkles, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ResponseCaseDTO } from "@/lib/community-report-types";

interface Candidate {
  id: string;
  fullName: string;
  ward: string | null;
  openCases: number;
}

interface Suggestion {
  chvId: string;
  fullName: string;
  reason: string;
  source: "qwen" | "rule";
}

const URGENCY_STYLES: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  high: "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300",
};

/**
 * Supervisor queue of community-report cases with no CHV yet. Qwen suggests
 * who should take each one (with a reason); the supervisor confirms or picks
 * someone else. Hidden entirely for roles that can't assign (403).
 */
export function UnassignedCasesPanel() {
  const [cases, setCases] = useState<ResponseCaseDTO[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/response-cases/unassigned", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setHidden(true);
          return;
        }
        const data = (await res.json()) as { cases?: ResponseCaseDTO[] };
        if (!cancelled) setCases(data.cases ?? []);
      } catch {
        if (!cancelled) setCases([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (hidden || cases === null) return null;

  return (
    <Card className="mb-6 gap-0 p-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Unassigned cases</h2>
          <p className="text-xs text-muted-foreground">
            Community reports waiting for a CHV. Qwen suggests who should respond; you confirm.
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground">
          {cases.length}
        </span>
      </div>
      {cases.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
          <Inbox className="size-4" aria-hidden /> Every case has a CHV.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {cases.map((c) => (
            <CaseRow
              key={c.id}
              c={c}
              onAssigned={() => setCases((prev) => prev?.filter((x) => x.id !== c.id) ?? null)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function CaseRow({ c, onAssigned }: { c: ResponseCaseDTO; onAssigned: () => void }) {
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/response-cases/${encodeURIComponent(c.id)}/suggest-assignment`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        suggestion?: Suggestion | null;
        candidates?: Candidate[];
        error?: string;
      };
      if (!res.ok) {
        setError(
          data.error === "NO_ELIGIBLE_CHVS"
            ? `No active CHVs in ${c.county} yet.`
            : "Couldn't get a suggestion. Try again."
        );
        return;
      }
      setCandidates(data.candidates ?? []);
      setSuggestion(data.suggestion ?? null);
      setChosen(data.suggestion?.chvId ?? data.candidates?.[0]?.id ?? "");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function assign() {
    if (!chosen) return;
    setAssigning(true);
    try {
      const reason =
        suggestion && chosen === suggestion.chvId
          ? `${suggestion.source === "qwen" ? "Suggested by Qwen" : "Suggested"}: ${suggestion.reason}`
          : "Chosen by supervisor";
      const res = await fetch(`/api/response-cases/${encodeURIComponent(c.id)}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chvId: chosen, reason }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error("Couldn't assign the case", { description: d.error ?? `HTTP ${res.status}` });
        return;
      }
      const name = candidates.find((x) => x.id === chosen)?.fullName ?? "the CHV";
      toast.success(`${c.caseCode} assigned`, { description: `${name} will see it in their Cases.` });
      onAssigned();
    } finally {
      setAssigning(false);
    }
  }

  const urgency = c.aiIntake?.urgency;
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-foreground">{c.caseCode}</span>
        <span className="text-xs capitalize text-muted-foreground">{c.reportCategory.replace(/_/g, " ")}</span>
        {urgency && (
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${URGENCY_STYLES[urgency]}`}>
            {urgency} urgency
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" aria-hidden />
          {c.county}
          {c.ward ? ` · ${c.ward}` : ""}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-foreground/90">{c.aiIntake?.summary || c.reportDescription}</p>

      {!suggestion && candidates.length === 0 ? (
        <div className="mt-3">
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={suggest} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {loading ? "Asking Qwen…" : "Suggest a CHV"}
          </Button>
          {error && <p className="mt-2 text-xs text-muted-foreground">{error}</p>}
        </div>
      ) : (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/40 p-3">
          {suggestion && (
            <p className="flex items-start gap-1.5 text-sm">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <span>
                <span className="font-medium text-foreground">{suggestion.fullName}</span>
                <span className="text-muted-foreground"> · {suggestion.reason}</span>
                {suggestion.source === "rule" && (
                  <span className="ml-1 text-xs text-muted-foreground">(rule-based; Qwen unavailable)</span>
                )}
              </span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={chosen} onValueChange={setChosen}>
              <SelectTrigger className="h-9 w-64" aria-label="CHV to assign">
                <SelectValue placeholder="Choose a CHV" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.fullName}
                    {x.ward ? ` · ${x.ward}` : ""} · {x.openCases} open
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" className="h-9" onClick={assign} disabled={!chosen || assigning}>
              {assigning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserCheck className="size-4" aria-hidden />}
              Assign
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
