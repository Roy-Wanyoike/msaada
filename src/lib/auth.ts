import { headers } from "next/headers";
import { db } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/utils/supabase/server";
import {
  clearLocalSession,
  getLocalSessionChv,
} from "@/lib/local-session";

/**
 * Auth facade — Supabase Auth is the PRIMARY provider whenever it is
 * configured. When the Supabase SSR client is unavailable (no env vars),
 * session resolution falls back to the local demo-mode provider in
 * src/lib/local-session.ts (scrypt + HMAC cookie sessions backed by
 * AuthSession rows). The fallback is only ever REACHABLE for sign-in when
 * the deployment is in demo mode (see src/lib/deployment-mode.ts); session
 * resolution falls back unconditionally so a cookie issued by a previous
 * demo-mode boot still validates (or fails closed) instead of erroring.
 */

/**
 * Local profile marker used for accounts whose credentials are owned by
 * Supabase Auth. Passwords are never copied into the Prisma database.
 */
export const SUPABASE_PASSWORD_MARKER = "supabase-auth-managed";

/**
 * Resolve the authenticated identity to the app's local operational profile.
 *
 * Primary: the verified Supabase JWT email is the bridge because
 * ChvUser.email is unique and existing records use non-UUID cuid identifiers
 * throughout the application's relational data. Authorization remains
 * server-side: user_metadata is intentionally ignored, and
 * suspended/deactivated local profiles fail closed even while a Supabase
 * session is otherwise valid.
 *
 * Fallback: with no Supabase client (unconfigured deployment), resolve via
 * the local demo-mode cookie session. Every failure mode returns null —
 * callers cannot tell "no session" from "invalid session", by design.
 */
export async function getSessionChv() {
  const supabase = await createSupabaseClient();
  if (!supabase) return getLocalSessionChv();

  const { data, error } = await supabase.auth.getClaims();
  const email = data?.claims.email;
  if (error || typeof email !== "string" || email.length === 0) return null;

  try {
    const chv = await db.chvUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!chv || (chv.authState && chv.authState !== "active")) return null;
    return chv;
  } catch {
    return null;
  }
}

/**
 * Sign out the current session. With Supabase configured this revokes the
 * Supabase refresh token and clears its auth cookies; without Supabase it
 * revokes the local AuthSession row and clears the local cookie. Returns the
 * local profile id for the best-effort audit trail without trusting
 * unverified cookie contents.
 */
export async function clearSession(): Promise<string | null> {
  const supabase = await createSupabaseClient();
  if (!supabase) return clearLocalSession();

  let userId: string | null = null;
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims.email;
  if (typeof email === "string" && email.length > 0) {
    try {
      const profile = await db.chvUser.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { id: true },
      });
      userId = profile?.id ?? null;
    } catch {
      // Logout must still clear the Supabase cookies during a DB outage.
    }
  }

  await supabase.auth.signOut({ scope: "local" });
  return userId;
}

/** Append an authentication audit event without ever storing credentials. */
export async function logAuthEvent(input: {
  event: "login_succeeded" | "login_failed" | "logout" | "session_rejected";
  userId?: string | null;
  emailAttempt?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    let userAgent: string | null = null;
    try {
      const h = await headers();
      userAgent = h.get("user-agent")?.slice(0, 180) ?? null;
    } catch {
      // Optional context only.
    }
    await db.authEvent.create({
      data: {
        event: input.event,
        userId: input.userId ?? null,
        emailAttempt: input.emailAttempt ?? null,
        detail: input.detail ?? null,
        userAgent,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[auth] event write failed:", msg.slice(0, 120));
  }
}

export async function requireChv() {
  const chv = await getSessionChv();
  if (!chv) throw new Error("UNAUTHORIZED");
  return chv;
}

/** Alias for requireChv — the "session guard" naming used by route docs. */
export const requireChvSession = requireChv;

export function rateLimitIdentifier(
  ip: string | null | undefined,
  email: string | null | undefined
): string {
  const safeIp = (ip ?? "unknown").trim().toLowerCase();
  const safeEmail = (email ?? "unknown").trim().toLowerCase();
  return `auth:${safeIp}:${safeEmail}`;
}

export const DEMO_CHV_EMAIL = "demo@msaada.health";
export const DEMO_CHV_PASSWORD = "msaada123";
export const DEMO_ADMIN_EMAIL = "county.admin@msaada.health";
export const DEMO_ADMIN_PASSWORD = "msaada123";
