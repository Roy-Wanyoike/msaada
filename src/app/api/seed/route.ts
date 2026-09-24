import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  hashPassword,
  DEMO_CHV_EMAIL,
  DEMO_CHV_PASSWORD,
} from "@/lib/auth";
import { classifyObservation } from "@/lib/qwen";
import { insertTriageRecord } from "@/lib/triage-store";
import { checkRateLimit } from "@/lib/rate-limit";
import type { County } from "@/lib/types";

// Mutates DB → never static.
export const dynamic = "force-dynamic";

/**
 * POST /api/seed
 *
 * Demo convenience: idempotently creates the demo CHV, then runs 9 synthetic
 * CHV observation transcripts through Qwen and stores the de-identified
 * records. Each record is backdated across the last 10 days so the dashboard
 * daily chart shows a realistic trend instead of a single today-spike.
 *
 * De-identification: the raw transcript strings below are processed in-memory
 * only — they are passed to classifyObservation and NEVER persisted. Only the
 * model-derived structured output (classification, observed_indicators,
 * aggregate_tag, chp_next_action, confidence_note, escalation) plus
 * county/ward + the demo CHV id is stored.
 *
 * Transcript distribution (9 total):
 *  - 4 routine
 *  - 3 needs_followup
 *  - 1 needs_facility_referral
 *  - 1 crisis (unambiguous self-harm intent + means — the crisis override
 *    is expected to fire and the record is stored with escalation=true)
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

async function ensureDemoChv() {
  let chv = await db.chvUser.findUnique({
    where: { email: DEMO_CHV_EMAIL },
  });
  if (!chv) {
    chv = await db.chvUser.create({
      data: {
        email: DEMO_CHV_EMAIL,
        passwordHash: hashPassword(DEMO_CHV_PASSWORD),
        fullName: "Demo CHV",
        county: "Kilifi",
        ward: "Malindi Town",
      },
    });
  }
  return chv;
}

async function backdateRecord(id: string, dayOffset: number) {
  if (dayOffset <= 0) return;
  const target = new Date();
  target.setDate(target.getDate() - dayOffset);
  // Normalize to mid-morning so the daily-bucket key (YYYY-MM-DD) is stable.
  target.setHours(10, 30, 0, 0);
  // Raw SQL per spec hint. SQLite stores DateTime as TEXT (ISO 8601);
  // Prisma serializes the Date param to ISO string automatically.
  await db.$executeRaw`UPDATE TriageRecord SET createdAt = ${target} WHERE id = ${id}`;
}

export async function POST(req: Request) {
  // Rate-limit per request IP. Each seed call spawns 9 Qwen LLM calls (~12-15s
  // each = ~2+ minutes of LLM compute) + 9 DB writes + 9 raw-SQL backdates.
  // Without a limit a single caller can DoS the LLM budget and bloat the DB.
  // 3 calls per 10 minutes is generous for demo/judge flows but blocks spam.
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

  const demoChv = await ensureDemoChv();

  const records: Array<{
    id: string;
    county: string;
    classification: string;
    escalation: boolean;
  }> = [];

  for (const t of TRANSCRIPTS) {
    // Transcript text is processed in-memory only — never persisted.
    const { output, fallbackUsed } = await classifyObservation(t.text);
    const record = await insertTriageRecord({
      submittedById: demoChv.id,
      county: t.county,
      ward: t.ward,
      output,
      fallbackUsed,
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

    records.push({
      id: record.id,
      county: record.county,
      classification: record.classification,
      escalation: record.escalation,
    });

    // De-identified log line.
    console.log(
      `[seed] stored id=${record.id} county=${record.county} ward=${
        record.ward
      } escalation=${record.escalation} classification=${
        record.classification
      } fallback=${fallbackUsed} dayOffset=${t.dayOffset}`
    );
  }

  return NextResponse.json(
    { seeded: records.length, records },
    { status: 200 }
  );
}
