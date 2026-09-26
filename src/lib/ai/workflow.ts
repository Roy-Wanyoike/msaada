import type { AiTask } from "@/lib/ai/client";

/**
 * The Msaada case journey, step by step, and who performs each step.
 * Drives the "Qwen at work" meter. Routing and the audit trail stay
 * deterministic by design: AI interprets, rules decide safety.
 */
export interface WorkflowStep {
  id: string;
  label: string;
  performer: "qwen" | "rules";
  /** Human sign-off on Qwen's output before it takes effect. */
  humanConfirms?: boolean;
  /** AiActivity task(s) that evidence this step. */
  tasks: AiTask[];
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  { id: "capture", label: "Voice note to text", performer: "qwen", humanConfirms: true, tasks: ["transcribe"] },
  { id: "privacy", label: "De-identification of stored notes", performer: "qwen", tasks: ["privacy_scan"] },
  { id: "interpret", label: "Visit interpretation", performer: "qwen", tasks: ["triage"] },
  { id: "guidance", label: "Why + next action in Kiswahili", performer: "qwen", tasks: ["triage"] },
  { id: "routing", label: "Safety routing (escalate / refer / follow up)", performer: "rules", tasks: [] },
  { id: "intake", label: "Public-report intake", performer: "qwen", tasks: ["report_intake"] },
  { id: "assign", label: "Case assignment", performer: "qwen", humanConfirms: true, tasks: ["assignment"] },
  { id: "prep", label: "Follow-up visit questions", performer: "qwen", tasks: ["followup_questions"] },
  { id: "handover", label: "Referral handover note", performer: "qwen", humanConfirms: true, tasks: ["referral_handover"] },
  { id: "outcome", label: "Case outcome recording", performer: "qwen", tasks: ["case_outcome"] },
  { id: "chv_report", label: "CHV weekly report", performer: "qwen", tasks: ["chv_weekly"] },
  { id: "supervisor", label: "Supervisor workload briefing", performer: "qwen", tasks: ["supervisor_briefing"] },
  { id: "county", label: "County briefing", performer: "qwen", tasks: ["dashboard_summary"] },
  { id: "audit", label: "Audit trail", performer: "rules", tasks: [] },
];
