/**
 * Offline-ready encounter draft queue — framework-neutral browser module.
 *
 * CHVs work in the field where connectivity is intermittent. Every encounter
 * observation is queued here (localStorage) BEFORE the network attempt; the
 * entry is removed once the server confirms the write. Anything still queued
 * is flushed by flushDrafts() (run on component mount and on the window
 * "online" event) to the first-party endpoint POST /api/encounters/drafts,
 * which authenticates via the app's own session cookie and mirrors the drafts
 * into the Supabase `encounter_drafts` cloud table server-side (see
 * supabase/schema.sql §3).
 *
 * Guarantees / constraints:
 *  - Never throws. Sync is best-effort; the primary Msaada app (cookie auth +
 *    SQLite) must keep working when Supabase is unconfigured (server answers
 *    503 → "not_configured"), the app session is expired (401 →
 *    "not_signed_in"), or the network is down.
 *  - SSR-safe: without `window` every function is a strict no-op.
 *  - No auth tokens are ever stored in the queue — the browser sends the
 *    HttpOnly session cookie; entries hold only caller payloads.
 *  - Payloads are structured metadata only (no raw observation free-text —
 *    project de-identification rule; the caller and the endpoint enforce it).
 */

/** localStorage bucket for queued drafts. Bump the version suffix to migrate. */
const STORAGE_KEY = "msaada.draft-queue.v1";

/** One queued draft, exactly as persisted in localStorage. */
export interface DraftEntry {
  /**
   * Client-generated idempotency key (crypto.randomUUID where available).
   * Doubles as the `encounter_drafts.client_uuid` unique key so retried
   * flushes never create duplicate rows.
   */
  clientUuid: string;
  /** Structured draft payload (JSON-serializable). No free-text, no tokens. */
  payload: unknown;
  /** ISO-8601 timestamp of when the draft was queued on this device. */
  queuedAt: string;
}

/** Why a flush could not fully succeed. */
export type FlushDraftsReason =
  | "offline"
  | "not_configured"
  | "not_signed_in"
  | "error";

export interface FlushDraftsResult {
  /** Drafts successfully upserted into `encounter_drafts` (and dequeued). */
  flushed: number;
  /** Drafts still queued locally after the flush attempt. */
  remaining: number;
  /** Known cause when the flush did not fully succeed. */
  reason?: FlushDraftsReason;
}

// --- Storage plumbing (all guarded — localStorage can be absent, full, or
// --- disabled by private-mode browser policies; none of that may throw) ----

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function readQueue(): DraftEntry[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is DraftEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as DraftEntry).clientUuid === "string" &&
        (entry as DraftEntry).payload !== undefined &&
        typeof (entry as DraftEntry).queuedAt === "string"
    );
  } catch {
    return [];
  }
}

function writeQueue(entries: DraftEntry[]): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded / storage disabled — drop silently; the caller still
    // holds its in-memory copy and the next flush attempt retries.
  }
}

/** crypto.randomUUID with safe fallbacks for non-secure contexts. */
function generateClientUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      ""
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last resort (non-cryptographic) — uniqueness within a device is enough
  // for an offline queue that only this device ever upserts.
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- Public API ------------------------------------------------------------

/** All drafts currently queued on this device ([] when storage unavailable). */
export function getQueuedDrafts(): DraftEntry[] {
  return readQueue();
}

/**
 * Queue a draft BEFORE the network attempt (write-ahead). Returns the stored
 * entry so the caller can removeDraft() it on success, or null when storage
 * is unavailable (SSR / private mode) — in which case there is nothing to
 * keep or flush.
 */
export function queueDraft(payload: unknown): DraftEntry | null {
  if (!hasLocalStorage()) return null;
  const entry: DraftEntry = {
    clientUuid: generateClientUuid(),
    payload,
    queuedAt: new Date().toISOString(),
  };
  try {
    const queue = readQueue();
    queue.push(entry);
    writeQueue(queue);
    return entry;
  } catch {
    return null;
  }
}

/** Remove a single draft (e.g. after its submission succeeded). No-op-safe. */
export function removeDraft(clientUuid: string): void {
  if (!hasLocalStorage()) return;
  try {
    writeQueue(readQueue().filter((e) => e.clientUuid !== clientUuid));
  } catch {
    // Never throw — losing a removal only risks an idempotent re-upsert.
  }
}

/**
 * Push every queued draft to POST /api/encounters/drafts (first-party,
 * cookie-authed). The endpoint upserts them into the Supabase
 * `encounter_drafts` mirror server-side with client_uuid idempotency and
 * answers {flushed: n} counting ONLY newly inserted rows.
 *
 * Order of guards (each short-circuits with an honest reason):
 *  1. SSR (no window)             → silent no-op
 *  2. empty queue                 → {flushed: 0, remaining: 0}
 *  3. offline (navigator.onLine)  → "offline"
 *  4. 401 (no/expired app session)→ "not_signed_in"
 *  5. 503 (Supabase env unset)    → "not_configured"
 *  6. any other failure           → "error"
 *
 * On success the whole sent batch is dequeued: rows were either newly
 * flushed or were already present in the cloud (idempotent skip) — in both
 * cases the draft is synced. The queue is re-read at removal time so drafts
 * queued while the flush was in flight are never clobbered.
 */
export async function flushDrafts(): Promise<FlushDraftsResult> {
  // SSR guard: no window → strict no-op.
  if (typeof window === "undefined") {
    return { flushed: 0, remaining: 0 };
  }

  const queue = readQueue();
  if (queue.length === 0) {
    return { flushed: 0, remaining: 0 };
  }

  // 1. Offline — keep everything queued for the next flush.
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { flushed: 0, remaining: queue.length, reason: "offline" };
  }

  try {
    const res = await fetch("/api/encounters/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Same-origin cookie auth (the app's own HMAC session) — explicit so
      // the contract survives future cross-port/dev-server changes.
      credentials: "include",
      body: JSON.stringify({
        drafts: queue.map((d) => ({
          clientUuid: d.clientUuid,
          ...(typeof d.payload === "object" && d.payload !== null
            ? (d.payload as Record<string, unknown>)
            : {}),
        })),
      }),
      cache: "no-store",
    });

    if (res.status === 401) {
      return { flushed: 0, remaining: queue.length, reason: "not_signed_in" };
    }
    if (res.status === 503) {
      return { flushed: 0, remaining: queue.length, reason: "not_configured" };
    }
    if (!res.ok) {
      return { flushed: 0, remaining: queue.length, reason: "error" };
    }

    const data = (await res.json().catch(() => ({}))) as { flushed?: number };

    // Success: everything we sent is synced (newly flushed OR already in the
    // cloud). Dequeue the exact batch we sent; re-read first so concurrently
    // queued drafts are preserved.
    const sent = new Set(queue.map((d) => d.clientUuid));
    writeQueue(readQueue().filter((d) => !sent.has(d.clientUuid)));

    return { flushed: data.flushed ?? 0, remaining: readQueue().length };
  } catch {
    // Never throw — sync is best-effort by design.
    return { flushed: 0, remaining: readQueue().length, reason: "error" };
  }
}
