# Work Record — fix-triage-api

- **Task ID:** fix-triage-api
- **Agent:** triage-api-fixer
- **Scope:** `src/app/api/triage/route.ts` ONLY (single-file fix).

## Context reviewed

- `/home/z/my-project/worklog.md` (architecture + 10 prior review rounds)
- `/home/z/my-project/reviews/audit-1-codebase.md` (codebase auditor; flagged the 500 detail leak as HIGH)
- `/home/z/my-project/reviews/audit-5-api.md` (API auditor; issue #4 in top-10 ranked HIGH — `detail = err.message` leaks Prisma table names / Qwen SDK upstream error bodies / JSON parse internals)
- `/home/z/my-project/src/app/api/triage/route.ts` (the target file)

Both auditors agreed: the inline comment "Never include observation_text in the detail" is misleading — `err.message` itself is unsanitized and may carry internal identifiers / upstream API bodies. The fix is to stop sending `err.message` to the client and to bound the input length so a 10MB body cannot trigger slow PII-regex + a heavy Qwen call.

## Changes made to `src/app/api/triage/route.ts`

### 1. Replaced the 500 `detail` leak (lines 167–181)

Before:
```ts
} catch (err) {
  const detail = err instanceof Error ? err.message : String(err);
  // Never include observation_text in the detail.
  console.error("[triage] unexpected failure:", detail);
  return NextResponse.json(
    { error: "TRIAGE_FAILED", detail },
    { status: 500 }
  );
}
```

After:
```ts
} catch (err) {
  // Log the full error server-side for debugging — never send to client.
  // err.message from Prisma (table/column names), the Qwen SDK (upstream API
  // error bodies), or JSON parsing can leak internals to the client, so we
  // return only a generic detail and keep the real error on the server.
  console.error("[triage] unexpected failure:", err);
  return NextResponse.json(
    {
      error: "TRIAGE_FAILED",
      detail:
        "An unexpected error occurred during triage. The observation was not stored.",
    },
    { status: 500 }
  );
}
```

Net: `err.message` no longer reaches the client. Server still logs the full `err` object (richer than before — now includes stack trace) for debugging.

### 2. Added 5000-char `observation_text` length guard (lines 75–81)

Inserted immediately after the existing min-length check, before the PII scrub + Qwen call:

```ts
// DoS / cost guard — reject oversized observations before the PII scrub
// regex (slow on huge input) and the Qwen call (rejected upstream, but
// body-parse + scrub cost already paid). 5000 chars is generous for any
// reasonable CHV home-visit narrative.
if (observation_text.length > 5000) {
  return bad("OBSERVATION_TOO_LONG", "observation_text");
}
```

Returns `400 { error: "OBSERVATION_TOO_LONG", field: "observation_text" }` via the existing `bad()` helper (shape consistent with the other 400 paths in this route).

### 3. Verified the JSON-parse try/catch (lines 57–62)

Already present and correct — no change needed:

```ts
let body: unknown;
try {
  body = await req.json();
} catch {
  return bad("INVALID_JSON");
}
```

Returns `400 { error: "INVALID_JSON" }` on malformed JSON. ✓

## Untouched logic (per task constraint)

- `checkRateLimit("triage:" + chv.id)` 10/60s token bucket — unchanged.
- `getSessionChv()` cookie-session gate — unchanged.
- `scrubPII()` redaction call — unchanged.
- `classifyObservation()` Qwen call — unchanged.
- `insertTriageRecord()` DB write — unchanged.
- `createFollowUp()` 48h follow-up side-effect — unchanged.
- `writeAuditEntry()` compliance audit log — unchanged.
- All other validation (county enum, ward-in-county, min-length) — unchanged.

## Verification

- `bun run lint` → PASS (no errors, no warnings). Exit 0.
- File diff verified by re-reading the full route after edits (182 lines, was 169).

## Stage Summary

- `/api/triage` no longer leaks internals via the 500 `detail` field (Prisma table names / Qwen SDK upstream bodies / JSON parse fragments are now server-log-only).
- DoS/cost guard added: `observation_text > 5000` chars rejected with `400 OBSERVATION_TOO_LONG` before the PII scrub regex (slow on huge input) and the Qwen call (rejected upstream, but body-parse + scrub cost already paid).
- The pre-existing `INVALID_JSON` try/catch was verified — no change needed.
- Lint passes cleanly.
