import { headers } from "next/headers";
import { db } from "@/lib/db";
import { createClient as createSupabaseClient } from "@/utils/supabase/server";

/**
 * Local profile marker used for accounts whose credentials are owned by
 * Supabase Auth. Passwords are never copied into the Prisma database.
 */
export const SUPABASE_PASSWORD_MARKER = "supabase-auth-managed";

/**
 * Resolve the authenticated Supabase identity to the app's local operational
 * profile. The verified JWT email is the bridge because ChvUser.email is
 * unique and existing records use non-UUID cuid identifiers throughout the
 * application's relational data.
 *
 * Authorization remains server-side: user_metadata is intentionally ignored,
 * and suspended/deactivated local profiles fail closed even while a Supabase
 * session is otherwise valid.
 */
export async function getSessionChv() {
  const supabase = await createSupabaseClient();
  if (!supabase) return null;

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
 * Sign out only the current Supabase session. Returns the local profile id for
 * the best-effort audit trail without trusting unverified cookie contents.
 */
export async function clearSession(): Promise<string | null> {
  const supabase = await createSupabaseClient();
  if (!supabase) return null;

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
