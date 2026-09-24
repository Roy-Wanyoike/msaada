import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Demo auth — substitutes for Supabase Auth in this sandbox (no Postgres/Auth
 * service available). For a 3-hour hackathon this is email/password with a
 * cookie session. The schema + RLS-equivalent design is documented in README.
 *
 * Production note: replace with Supabase Auth + auth.uid() RLS policies.
 */

const SESSION_COOKIE = "msaada_session";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 32);
  const target = Buffer.from(hash, "hex");
  return test.length === target.length && timingSafeEqual(test, target);
}

export function createSessionToken(chvId: string): string {
  // Simple signed-ish token for demo. NOT cryptographically secure — Supabase
  // would issue a JWT. Sufficient for the demo's "auth.uid() = submitting user"
  // equivalent.
  const payload = { uid: chvId, exp: Date.now() + SESSION_TTL * 1000 };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function parseSessionToken(token: string): { uid: string; exp: number } | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8")
    ) as { uid?: string; exp?: number };
    if (!decoded.uid || !decoded.exp) return null;
    if (decoded.exp < Date.now()) return null;
    return { uid: decoded.uid, exp: decoded.exp };
  } catch {
    return null;
  }
}

export async function setSession(chvId: string) {
  const token = createSessionToken(chvId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionChv() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const parsed = parseSessionToken(token);
  if (!parsed) return null;
  const chv = await db.chvUser.findUnique({ where: { id: parsed.uid } });
  return chv;
}

export async function requireChv() {
  const chv = await getSessionChv();
  if (!chv) throw new Error("UNAUTHORIZED");
  return chv;
}

export const DEMO_CHV_EMAIL = "demo@msaada.health";
export const DEMO_CHV_PASSWORD = "msaada123";
