import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SUPABASE_PASSWORD_MARKER,
  DEMO_CHV_EMAIL,
} from "@/lib/auth";
import { classifyObservation } from "@/lib/ai/triage";
import { insertTriageRecord, writeAuditEntry } from "@/lib/triage-store";
import { checkRateLimit } from "@/lib/rate-limit";
import { isDemoMode } from "@/lib/deployment-mode";
import { generateCode } from "@/lib/identity-types";
import {
  evaluatePolicy,
  getDestinationForCategory,
  type ModelInterpretation,
} from "@/lib/policy-engine";
import type { County } from "@/lib/types";

// Mutates DB → never static.
export const dynamic = "force-dynamic";

/**
 * POST /api/seed
 *
 * Demo convenience: idempotently creates the demo CHV + 4 demo households
 * (one per county) + 2-3 members per household, then runs 9 synthetic CHV
 * observation transcripts through Qwen and stores the de-identified
 * records. Each transcript is attached to a household + member from the
 * same county via a completed Encounter, and the policy engine is run on
 * the interpretation so referrals are created when the policy says
 * referral_required or crisis_override. The full identity chain
 * (Household → Member → Encounter → TriageRecord → Referral) is therefore
 * represented in the seed data so the dashboard / lists show realistic
 * referrals.
 *
 * Each record is backdated across the last 10 days so the dashboard daily
 * chart shows a realistic trend instead of a single today-spike. The
 * matching Encounter is backdated to the same day so the encounter +
 * observation + referral all line up chronologically.
 *
 * De-identification: the raw transcript strings below are processed
 * in-memory only — they are passed to classifyObservation and NEVER
 * persisted. Only the model-derived structured output (classification,
 * observed_indicators, aggregate_tag, chp_next_action, confidence_note,
 * escalation) plus county/ward + the demo CHV id is stored.
 *
 * Idempotency:
 *  - CHV: matched by email.
 *  - Household: matched by (chwId + label) — label is a mnemonic, never
 *    a name. householdCode is regenerated on first create only.
 *  - Member: matched by (householdId + displayName). memberCode likewise
 *    regenerated on first create only.
 *  - Encounter / TriageRecord / Referral: NOT idempotent — each seed
 *    call appends a fresh batch (rate-limited 3/10min/IP so this is
 *    bounded).
 *
 * Transcript distribution (9 total):
 *  - 4 routine
 *  - 3 needs_followup
 *  - 1 needs_facility_referral
 *  - 1 crisis (unambiguous self-harm intent + means — the crisis
 *    override is expected to fire and the record is stored with
 *    escalation=true; the policy engine creates an emergency referral
 *    so the dashboard Referrals list is non-empty).
 *
 * TODO (production): remove or gate behind admin auth.
 */

interface Transcript {
  /** In-memory only — never persisted. */
  text: string;
  county: County;
  ward: string;
  /** Days ago to backdate this record's createdAt (0 = today). */
  dayOffset: number;
}

const TRANSCRIPTS: Transcript[] = [
  // --- ROUTINE (4) ---
  {
    text: "Mama wa Household A amelala vizuri wiki hii, ana appetite mzuri, anakula chakula bila shida. Anaendelea na kazi zake za nyumbani na hana malalamiko yoyote. Alikuwa mchangamfu na kucheka na watoto wakati wa ziara.",
    county: "Kilifi",
    ward: "Malindi Town",
    dayOffset: 9,
  },
  {
    // Nairobi routine — light Sheng (poa, rama, kawa, noma, kam, kej) layered
    // onto Swahili + English to satisfy the "mixed Eng/Swa/Sheng" requirement.
    text: "Baba wa Household B ako poa, anarama vizuri usiku, anado kazi zake kama kawa. Alikuwa mtu wa changamka wakati wa ziara, alikam jirani wa kej na kudo mazungumzo naye vizuri. Hakuna noma yoyote iliandama nyumbani, hakuna dalili za wasiwasi zilionekana.",
    county: "Nairobi",
    ward: "Mathare",
    dayOffset: 7,
  },
  {
    text: "Mtu wa Household C anaonekana mwenye nguvu, anakula vizuri, anapumua vizuri. Alikuwa akicheza na watoto wake nyuma ya nyumba. Ameendelea na shughuli zake za kila siku bila malalamiko yoyote.",
    county: "Turkana",
    ward: "Turkana Central",
    dayOffset: 6,
  },
  {
    text: "Mama wa Household D amekuwa mchangamfu, analala vizuri, ana appetite mzuri, ana shughuli zake za kila siku. Hagua mara kwa mara. Alikuwa akitabasamu wakati wa ziara yetu leo.",
    county: "Mombasa",
    ward: "Kisauni",
    dayOffset: 5,
  },
  // --- NEEDS_FOLLOWUP (3) ---
  {
    text: "Baba wa Household E amekuwa akijitenga na watu wiki mbili sasa, halali vizuri usiku, anaamka mapema sana asubuhi. Halingi nje kama kawaida, anakaa ndani tu. Hana appetite kubwa, anakula kidogo tu.",
    county: "Kilifi",
    ward: "Magarini",
    dayOffset: 4,
  },
  {
    // Nairobi needs_followup — Sheng tinge (noma, kawa, rama, daktari) on Swa.
    text: "Mama wa Household F anaskia noma, anarama kidogo tu, hana nguvu ya kudo kazi zake za kawa. Hanaski hamu na chakula wiki hii. Anasema hajiskii vizuri lakini hataka kumuona daktari — anasema ni kagongo tu na litapita.",
    county: "Nairobi",
    ward: "Kibra",
    dayOffset: 3,
  },
  {
    text: "Mtu wa Household G ameonekana kujitenga na watu siku za hivi karibuni, hataongea sana na jirani. Anakaa kwenye sebuleni tu, hafungui milango mingi. Analala vizuri lakini yupo kimya sana muda mwingi.",
    county: "Mombasa",
    ward: "Likoni",
    dayOffset: 3,
  },
  // --- NEEDS_FACILITY_REFERRAL (1) ---
  {
    text: "Mama wa Household H hawezi kulala kabisa wiki mbili sasa, hafai chakula vizuri, analia mara kwa mara bila sababu, anaonekana very low. Hana nguvu hata kusimama vizuri. Anasema hajisikii na kuona kama hakuna tumaini tena.",
    county: "Turkana",
    ward: "Loima",
    dayOffset: 2,
  },
  // --- CRISIS (1) — UNAMBIGUOUS self-harm intent + means + plan ---
  {
    text: "Mtoto wa Household I amesema anaataka kujidhuru, amesema ataingia kwenye river leo. Ameshanusha blanket yake na kujifunga shingoni. Anasema hana sababu ya kuishi tena. Nimebaki naye nikimwangalia ili asibaki peke yake.",
    county: "Kilifi",
    ward: "Kaloleni",
    dayOffset: 1,
  },
];

// ---- Demo household + member specs (one household per county) ----
// Labels are MNEMONICS, never names — the CHV uses them to recognize the
// household without storing PII (§3 data minimization). Kinship roles
// (Mama/Baba/Bibi/Mtoto) replace real names for the same reason.

interface MemberSpec {
  displayName: string;
  role: string;
  ageBand: string | null;
}

interface HouseholdSpec {
  county: County;
  ward: string;
  label: string;
  members: MemberSpec[];
}

const HOUSEHOLDS: HouseholdSpec[] = [
  {
    county: "Kilifi",
    ward: "Malindi Town",
    label: "Household 1, Malindi",
    members: [
      { displayName: "Mama", role: "mother", ageBand: "25-49" },
      { displayName: "Baba", role: "father", ageBand: "25-49" },
      { displayName: "Mtoto — age 8", role: "child", ageBand: "5-14" },
    ],
  },
  {
    county: "Nairobi",
    ward: "Mathare",
    label: "Household 1, Mathare",
    members: [
      { displayName: "Mama", role: "mother", ageBand: "25-49" },
      { displayName: "Mtoto — age 5", role: "child", ageBand: "<5" },
    ],
  },
  {
    county: "Turkana",
    ward: "Turkana Central",
    label: "Household 1, Lodwar",
    members: [
      { displayName: "Baba", role: "father", ageBand: "25-49" },
      { displayName: "Bibi", role: "grandparent", ageBand: "50+" },
      { displayName: "Mtoto — age 12", role: "child", ageBand: "5-14" },
    ],
  },
  {
    county: "Mombasa",
    ward: "Kisauni",
    label: "Household 1, Kisauni",
    members: [
      { displayName: "Mama", role: "mother", ageBand: "25-49" },
      { displayName: "Baba", role: "father", ageBand: "25-49" },
    ],
  },
];

interface SeededHousehold {
  id: string;
  county: County;
  ward: string;
  label: string;
  members: Array<{ id: string; displayName: string }>;
}

async function ensureDemoChv() {
  let chv = await db.chvUser.findUnique({
    where: { email: DEMO_CHV_EMAIL },
  });
  if (!chv) {
    chv = await db.chvUser.create({
      data: {
        email: DEMO_CHV_EMAIL,
        passwordHash: SUPABASE_PASSWORD_MARKER,
        fullName: "Demo CHV",
        county: "Kilifi",
        ward: "Malindi Town",
      },
    });
  }
  return chv;
}

/**
 * Idempotently creates the 4 demo households + their members. Existing
 * rows are matched by (chwId + label) for households and (householdId +
 * displayName) for members — stable across repeated seed calls. Codes
 * are regenerated only on first creation, so the stored MSD-HH-XXXX /
 * MSD-M-XXXX values are stable across runs.
 */
async function ensureHouseholds(chwId: string): Promise<SeededHousehold[]> {
  const out: SeededHousehold[] = [];
  for (const spec of HOUSEHOLDS) {
    let household = await db.household.findFirst({
      where: { chwId, label: spec.label },
    });
    if (!household) {
      household = await db.household.create({
        data: {
          householdCode: generateCode("MSD-HH"),
          chwId,
          county: spec.county,
          ward: spec.ward,
          label: spec.label,
          status: "active",
        },
      });
    }

    const members: Array<{ id: string; displayName: string }> = [];
    for (const m of spec.members) {
      let member = await db.householdMember.findFirst({
        where: { householdId: household.id, displayName: m.displayName },
      });
      if (!member) {
        member = await db.householdMember.create({
          data: {
            memberCode: generateCode("MSD-M"),
            householdId: household.id,
            displayName: m.displayName,
            role: m.role,
            ageBand: m.ageBand,
            status: "active",
          },
        });
      }
      members.push({ id: member.id, displayName: member.displayName });
    }

    out.push({
      id: household.id,
      county: household.county as County,
      ward: household.ward ?? spec.ward,
      label: household.label,
      members,
    });
  }
  return out;
}

/**
 * Picks a household + member for the given transcript, cycling through
 * the household's members so multiple transcripts in the same county
 * are spread across different members when the household has more than
 * one. The cursor is stateful across the loop (mutated in place by the
 * caller via memberCursor).
 */
function pickHouseholdAndMember(
  households: SeededHousehold[],
  county: County,
  cursor: number
): { household: SeededHousehold; member: { id: string; displayName: string } } {
  const household =
    households.find((h) => h.county === county) ?? households[0];
  const member =
    household.members[cursor % household.members.length] ??
    household.members[0];
  return { household, member };
}

/** Compute a backdated mid-morning timestamp for a given dayOffset. */
function backdatedTimestamp(dayOffset: number): Date {
  const target = new Date();
  if (dayOffset <= 0) return target;
  target.setDate(target.getDate() - dayOffset);
  // Normalize to mid-morning so the daily-bucket key (YYYY-MM-DD) is stable.
  target.setHours(10, 30, 0, 0);
  return target;
}

async function backdateRecord(id: string, dayOffset: number) {
  if (dayOffset <= 0) return;
  const target = backdatedTimestamp(dayOffset);
  // Raw SQL per spec hint. SQLite stores DateTime as TEXT (ISO 8601);
  // Prisma serializes the Date param to ISO string automatically.
  await db.$executeRaw`UPDATE TriageRecord SET createdAt = ${target} WHERE id = ${id}`;
}

/**
 * Build the ModelInterpretation expected by evaluatePolicy from the
 * Qwen output. Mirrors the same projection used in /api/triage so the
 * policy engine sees the same interpretation shape regardless of
 * whether the record came from the live API or the seed flow.
 */
function toInterpretation(
  output: Awaited<ReturnType<typeof classifyObservation>>["output"],
  fallbackUsed: boolean
): ModelInterpretation {
  const isCrisis = output.escalation === true;
  return {
    escalation: isCrisis,
    classification: isCrisis
      ? "needs_facility_referral"
      : output.classification,
    observedIndicators: isCrisis ? [] : output.observed_indicators,
    aggregateTag: isCrisis ? "crisis_self_harm" : (output.aggregate_tag ?? null),
    chpNextAction: isCrisis ? null : output.chp_next_action,
    chpInstruction: isCrisis ? output.chp_instruction : null,
    crisisLine: isCrisis ? output.crisis_line : null,
    confidenceNote: isCrisis
      ? "Crisis override triggered"
      : (output.confidence_note ?? null),
    fallbackUsed,
  };
}

export async function POST(req: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // Rate-limit per request IP. Each seed call spawns 9 Qwen LLM calls
  // (~12-15s each = ~2+ minutes of LLM compute) + 9 encounter/record/
  // referral writes + 9 raw-SQL backdates. Without a limit a single
  // caller can DoS the LLM budget and bloat the DB. 3 calls per 10
  // minutes is generous for demo/judge flows but blocks spam.
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "unknown";
  // The header may be a comma-separated list of IPs when proxied through
  // multiple hops — take the leftmost (the originating client IP).
  const ip = forwardedFor.split(",")[0].trim() || "unknown";
  const rl = checkRateLimit(`seed:${ip}`, {
    capacity: 3,
    windowMs: 10 * 60_000,
  });
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfter },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  // 1. Demo CHV (idempotent by email).
  const demoChv = await ensureDemoChv();

  // 2. Demo households + members (idempotent by chwId+label / householdId+
  //    displayName). Built BEFORE the transcript loop so every encounter
  //    can be linked to a real household + member from the same county.
  const households = await ensureHouseholds(demoChv.id);

  // Per-county cursor so multiple transcripts in the same county rotate
  // through different members (when the household has >1 member). The
  // Kilifi household has 3 members; its 3 transcripts will land on each
  // of them in turn. This keeps the seed data varied without storing
  // additional households.
  const memberCursor: Record<County, number> = {
    Kilifi: 0,
    Nairobi: 0,
    Turkana: 0,
    Mombasa: 0,
  };

  const records: Array<{
    id: string;
    encounterId: string | null;
    householdId: string;
    memberId: string;
    county: string;
    classification: string;
    escalation: boolean;
    workflowClass: string;
  }> = [];

  const referrals: Array<{
    id: string;
    encounterId: string;
    householdId: string;
    memberId: string;
    category: string;
    priority: string;
  }> = [];

  for (const t of TRANSCRIPTS) {
    // 3. Pick a household + member from the same county as the transcript.
    const cursor = memberCursor[t.county] ?? 0;
    memberCursor[t.county] = cursor + 1;
    const { household, member } = pickHouseholdAndMember(
      households,
      t.county,
      cursor
    );

    // 4. Create a completed Encounter for this transcript. Started/completed
    //    timestamps are backdated inline to match the transcript's dayOffset
    //    so the encounter + observation + referral all line up on the same
    //    calendar day.
    const ts = backdatedTimestamp(t.dayOffset);
    const encounter = await db.encounter.create({
      data: {
        encounterCode: generateCode("MSD-ENC"),
        householdId: household.id,
        memberId: member.id,
        chwId: demoChv.id,
        status: "completed",
        captureMethod: "text",
        connectivity: "online",
        startedAt: ts,
        completedAt: ts,
      },
    });

    // 5. Qwen interprets the observation (transcript text is in-memory only).
    const { output, fallbackUsed, model: aiModel, promptVersion } = await classifyObservation(t.text);

    // 6. Persist the de-identified triage record, linked to the encounter.
    const record = await insertTriageRecord({
      submittedById: demoChv.id,
      county: t.county,
      ward: t.ward,
      output,
      fallbackUsed,
      aiModel,
      promptVersion,
      encounterId: encounter.id,
    });

    // Backdate across the last 10 days so the daily chart shows a trend.
    try {
      await backdateRecord(record.id, t.dayOffset);
    } catch (err) {
      // Backdate failure is non-fatal — record still exists (just with
      // today's createdAt). Log de-identified context only.
      console.error(
        `[seed] backdate failed id=${record.id} offset=${t.dayOffset}:`,
        err instanceof Error ? err.message : String(err)
      );
    }

    // 7. Deterministic policy engine (§10, §12). The AI can NEVER override
    //    or downgrade a safety-critical signal — crisis_override always
    //    fires unconditionally here.
    const interpretation = toInterpretation(output, fallbackUsed);
    const policyDecision = evaluatePolicy(interpretation);

    // 8. Create a Referral when the policy says referral_required or
    //    crisis_override AND the policy actually emitted a priority +
    //    category (the crisis path always does). The referral is linked
    //    to the encounter + household + member (identity chain §15).
    if (
      (policyDecision.workflowClass === "referral_required" ||
        policyDecision.workflowClass === "crisis_override") &&
      policyDecision.referralPriority &&
      policyDecision.referralCategory
    ) {
      try {
        const referral = await db.referral.create({
          data: {
            referralCode: generateCode("MSD-REF"),
            encounterId: encounter.id,
            householdId: household.id,
            memberId: member.id,
            category: policyDecision.referralCategory,
            priority: policyDecision.referralPriority,
            destination: getDestinationForCategory(
              policyDecision.referralCategory
            ),
            status: "created",
            createdById: demoChv.id,
            createdBy: demoChv.id,
            followUpRequired: policyDecision.followUpRequired,
          },
        });
        referrals.push({
          id: referral.id,
          encounterId: encounter.id,
          householdId: household.id,
          memberId: member.id,
          category: referral.category,
          priority: referral.priority,
        });
      } catch (err) {
        // Referral failure is non-fatal — the triage record is still stored.
        console.error(
          `[seed] referral create failed encounterId=${encounter.id}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    records.push({
      id: record.id,
      encounterId: record.encounterId,
      householdId: household.id,
      memberId: member.id,
      county: record.county,
      classification: record.classification,
      escalation: record.escalation,
      workflowClass: policyDecision.workflowClass,
    });

    // De-identified log line — includes household/encounter identity + the
    // policy decision so the seed run is auditable in dev.log.
    console.log(
      `[seed] stored id=${record.id} encounterId=${encounter.id} householdId=${
        household.id
      } memberId=${member.id} county=${record.county} ward=${
        record.ward ?? "-"
      } escalation=${record.escalation} classification=${
        record.classification
      } fallback=${fallbackUsed} policy=${policyDecision.policyVersion}:${
        policyDecision.workflowClass
      } dayOffset=${t.dayOffset}`
    );
  }

  // ---- Audit: ONE row per seed call (MVP-44) — not per row. The seed is
  // a demo-data load, not a clinical event; a single demo_seed entry keeps
  // the audit trail honest about provenance without flooding it.
  await writeAuditEntry({
    actorId: demoChv.id,
    event: "demo_seed",
    county: demoChv.county ?? "Kilifi",
    ward: demoChv.ward ?? null,
    classification: `batch:${records.length}`,
    organizationId: demoChv.organizationId ?? null,
    authorizationRole: demoChv.role ?? "chv",
  }).catch((e) => {
    console.error("[seed] audit log write failed:", e);
  });

  return NextResponse.json(
    {
      seeded: records.length,
      records,
      referrals,
      households: households.map((h) => ({
        id: h.id,
        county: h.county,
        label: h.label,
        memberCount: h.members.length,
      })),
    },
    { status: 200 }
  );
}
