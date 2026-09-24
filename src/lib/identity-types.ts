// Identity-chain types (§2, §3, §6, §13) — Household → Member → Encounter → Referral.

/** Stable code prefix per entity type (§2 — MSD-XX-XXXX). */
export const ID_PREFIXES = {
  household: "MSD-HH",
  member: "MSD-M",
  encounter: "MSD-ENC",
  referral: "MSD-REF",
  followUp: "MSD-FU",
} as const;

/** Generates a human-readable stable code (e.g. MSD-HH-8F42K). */
export function generateCode(prefix: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 5; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${suffix}`;
}

export interface HouseholdDTO {
  id: string;
  householdCode: string;
  chwId: string;
  county: string;
  ward: string | null;
  label: string;
  status: string;
  memberCount: number;
  encounterCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdMemberDTO {
  id: string;
  memberCode: string;
  householdId: string;
  displayName: string;
  role: string | null;
  ageBand: string | null;
  status: string;
  createdAt: string;
}

export interface EncounterDTO {
  id: string;
  encounterCode: string;
  householdId: string;
  memberId: string;
  chwId: string;
  status: string;
  captureMethod: string;
  connectivity: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  /** Denormalized for the UI. */
  householdLabel: string;
  memberDisplayName: string;
  /** Observation count in this encounter. */
  observationCount: number;
  /** Latest classification (if any). */
  latestClassification: string | null;
  latestEscalation: boolean;
}

export interface ReferralDTO {
  id: string;
  referralCode: string;
  encounterId: string;
  householdId: string;
  memberId: string;
  category: string;
  priority: string;
  destination: string | null;
  status: string;
  createdById: string;
  createdAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
  followUpRequired: boolean;
  /** Denormalized. */
  householdLabel: string;
  memberDisplayName: string;
}

export const ENCOUNTER_STATES = [
  "draft",
  "in_progress",
  "completed",
  "sync_pending",
  "synced",
  "processing",
  "processed",
  "requires_review",
  "closed",
] as const;

export const REFERRAL_STATES = [
  "created",
  "sent",
  "acknowledged",
  "in_progress",
  "completed",
  "declined",
  "cancelled",
  "expired",
] as const;
