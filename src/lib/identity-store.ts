import { db } from "@/lib/db";
import { generateCode, type HouseholdDTO, type HouseholdMemberDTO, type EncounterDTO, type ReferralDTO } from "@/lib/identity-types";

/**
 * Data-access for the identity chain (Household, Member, Encounter, Referral).
 * All reads are ownership-scoped (a CHV sees only their assigned households —
 * the RLS equivalent per section 5, 18). The raw observation text is never
 * stored here — these entities hold IDs + labels + lifecycle state only.
 */

// ---- Household ----

export async function createHousehold(args: {
  chwId: string;
  county: string;
  ward?: string;
  label: string;
}): Promise<HouseholdDTO> {
  const created = await db.household.create({
    data: {
      householdCode: generateCode("MSD-HH"),
      chwId: args.chwId,
      county: args.county,
      ward: args.ward ?? null,
      label: args.label,
    },
  });
  return toHouseholdDTO(created, 0, 0);
}

export async function getMyHouseholds(chwId: string): Promise<HouseholdDTO[]> {
  const households = await db.household.findMany({
    where: { chwId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  const counts = await Promise.all(
    households.map(async (h) => {
      const [memberCount, encounterCount] = await Promise.all([
        db.householdMember.count({ where: { householdId: h.id, status: "active" } }),
        db.encounter.count({ where: { householdId: h.id } }),
      ]);
      return { id: h.id, memberCount, encounterCount };
    })
  );
  const countMap = new Map(counts.map((c) => [c.id, c]));
  return households.map((h) =>
    toHouseholdDTO(h, countMap.get(h.id)?.memberCount ?? 0, countMap.get(h.id)?.encounterCount ?? 0)
  );
}

function toHouseholdDTO(
  row: { id: string; householdCode: string; chwId: string; county: string; ward: string | null; label: string; status: string; createdAt: Date; updatedAt: Date },
  memberCount: number,
  encounterCount: number
): HouseholdDTO {
  return {
    id: row.id,
    householdCode: row.householdCode,
    chwId: row.chwId,
    county: row.county,
    ward: row.ward,
    label: row.label,
    status: row.status,
    memberCount,
    encounterCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---- HouseholdMember ----

export async function createMember(args: {
  householdId: string;
  displayName: string;
  role?: string;
  ageBand?: string;
}): Promise<HouseholdMemberDTO> {
  const created = await db.householdMember.create({
    data: {
      memberCode: generateCode("MSD-M"),
      householdId: args.householdId,
      displayName: args.displayName,
      role: args.role ?? null,
      ageBand: args.ageBand ?? null,
    },
  });
  return toMemberDTO(created);
}

export async function getMembers(householdId: string): Promise<HouseholdMemberDTO[]> {
  const members = await db.householdMember.findMany({
    where: { householdId, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  return members.map(toMemberDTO);
}

function toMemberDTO(row: {
  id: string; memberCode: string; householdId: string; displayName: string;
  role: string | null; ageBand: string | null; status: string; createdAt: Date;
}): HouseholdMemberDTO {
  return {
    id: row.id,
    memberCode: row.memberCode,
    householdId: row.householdId,
    displayName: row.displayName,
    role: row.role,
    ageBand: row.ageBand,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---- Encounter ----

export async function createEncounter(args: {
  householdId: string;
  memberId: string;
  chwId: string;
  captureMethod?: string;
  connectivity?: string;
}): Promise<EncounterDTO> {
  const created = await db.encounter.create({
    data: {
      encounterCode: generateCode("MSD-ENC"),
      householdId: args.householdId,
      memberId: args.memberId,
      chwId: args.chwId,
      status: "in_progress",
      captureMethod: args.captureMethod ?? "text",
      connectivity: args.connectivity ?? "online",
    },
    include: {
      household: { select: { label: true } },
      member: { select: { displayName: true } },
    },
  });
  return toEncounterDTO(created, 0, null, false);
}

export async function getMyEncounters(chwId: string, limit = 20): Promise<EncounterDTO[]> {
  const encounters = await db.encounter.findMany({
    where: { chwId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      household: { select: { label: true } },
      member: { select: { displayName: true } },
    },
  });
  const withObs = await Promise.all(
    encounters.map(async (e) => {
      const latest = await db.triageRecord.findFirst({
        where: { encounterId: e.id },
        orderBy: { createdAt: "desc" },
        select: { classification: true, escalation: true },
      });
      const count = await db.triageRecord.count({ where: { encounterId: e.id } });
      return {
        enc: e,
        observationCount: count,
        latestClassification: latest?.classification ?? null,
        latestEscalation: latest?.escalation ?? false,
      };
    })
  );
  return withObs.map((w) =>
    toEncounterDTO(w.enc, w.observationCount, w.latestClassification, w.latestEscalation)
  );
}

function toEncounterDTO(
  row: {
    id: string; encounterCode: string; householdId: string; memberId: string; chwId: string;
    status: string; captureMethod: string; connectivity: string; startedAt: Date;
    completedAt: Date | null; createdAt: Date;
    household: { label: string } | null;
    member: { displayName: string } | null;
  },
  observationCount: number,
  latestClassification: string | null,
  latestEscalation: boolean
): EncounterDTO {
  return {
    id: row.id,
    encounterCode: row.encounterCode,
    householdId: row.householdId,
    memberId: row.memberId,
    chwId: row.chwId,
    status: row.status,
    captureMethod: row.captureMethod,
    connectivity: row.connectivity,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    householdLabel: row.household?.label ?? "—",
    memberDisplayName: row.member?.displayName ?? "—",
    observationCount,
    latestClassification,
    latestEscalation,
  };
}

// ---- Referral ----

export async function getMyReferrals(chwId: string, status?: string): Promise<ReferralDTO[]> {
  const where = { createdById: chwId, ...(status ? { status } : {}) };
  const referrals = await db.referral.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      encounter: {
        include: {
          household: { select: { label: true } },
          member: { select: { displayName: true } },
        },
      },
    },
  });
  return referrals.map(toReferralDTO);
}

function toReferralDTO(row: {
  id: string; referralCode: string; encounterId: string; householdId: string; memberId: string;
  category: string; priority: string; destination: string | null; status: string;
  createdById: string; createdAt: Date; acknowledgedBy: string | null;
  acknowledgedAt: Date | null; completedAt: Date | null; followUpRequired: boolean;
  encounter: { household: { label: string } | null; member: { displayName: string } | null } | null;
}): ReferralDTO {
  return {
    id: row.id,
    referralCode: row.referralCode,
    encounterId: row.encounterId,
    householdId: row.householdId,
    memberId: row.memberId,
    category: row.category,
    priority: row.priority,
    destination: row.destination,
    status: row.status,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    followUpRequired: row.followUpRequired,
    householdLabel: row.encounter?.household?.label ?? "—",
    memberDisplayName: row.encounter?.member?.displayName ?? "—",
  };
}
