// Community Report types (CR-001 through CR-018)
// A community member submits a concern → AI structures it → deterministic
// policy routes it → CHV is assigned → CHV attends → encounter → outcome.

export const REPORT_STATUSES = [
  "received", "triage_pending", "triaged", "ready_for_assignment",
  "duplicate", "outside_scope", "cancelled", "closed",
] as const;

export const CASE_STATUSES = [
  "received", "triaged", "ready_for_assignment", "assigned", "accepted",
  "response_started", "attended", "follow_up_required", "resolved",
  "unable_to_reach", "reassignment_required", "duplicate", "escalated", "cancelled",
] as const;

export const REPORT_CATEGORIES = [
  "mental_health", "maternal", "child_health", "social_support", "other",
] as const;

export interface CommunityReportDTO {
  id: string;
  reportCode: string;
  createdAt: string;
  updatedAt: string;
  reporterName: string | null;
  reporterContact: string | null;
  reporterType: string;
  subjectType: string;
  subjectPersonId: string | null;
  subjectHouseholdId: string | null;
  description: string;
  category: string;
  county: string;
  ward: string | null;
  landmark: string | null;
  directions: string | null;
  channel: string;
  status: string;
  aiInterpretation: string | null;
  aiModelVersion: string | null;
  aiConfidence: number | null;
  aiProcessedAt: string | null;
  policyVersion: string | null;
  policyWorkflowClass: string | null;
  responseCaseCount: number;
}

export interface ResponseCaseDTO {
  id: string;
  caseCode: string;
  createdAt: string;
  updatedAt: string;
  reportId: string;
  reportCode: string;
  assignedChvId: string | null;
  assignedSupervisorId: string | null;
  assignmentReason: string | null;
  assignedAt: string | null;
  acceptedAt: string | null;
  status: string;
  encounterId: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  // Denormalized from the report
  reportDescription: string;
  reportCategory: string;
  county: string;
  ward: string | null;
  landmark: string | null;
  directions: string | null;
  /** AI intake extras (advisory; null/empty when the model didn't run). */
  aiIntake: {
    summary: string;
    urgency: "low" | "medium" | "high";
    suggestedCategory: string;
    questionsForVisit: string[];
    missingInformation: string[];
  } | null;
}
