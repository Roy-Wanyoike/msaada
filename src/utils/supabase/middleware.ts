import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "./config";

/**
 * Session-refresh middleware step (called from src/proxy.ts on every matched
 * request).
 *
 * Supabase auth tokens live in cookies (sb-*). When they are expired, calling
 * getClaims() triggers a refresh when needed, then verifies the JWT, and the SDK
 * hands back the Set-Cookie headers we must forward — otherwise a user with a
 * still-valid refresh token gets logged out mid-session.
 *
 * When Supabase isn't configured this is a strict pass-through; auth endpoints
 * themselves return an explicit SERVER_NOT_CONFIGURED response.
 */
export async function updateSession(request: NextRequest) {
  const config = supabaseConfig();
  if (!config) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
        Object.entries(headersToSet).forEach(([name, value]) =>
          supabaseResponse.headers.set(name, value)
        );
      },
    },
  });

  // IMPORTANT: keep this immediately after client construction. getClaims()
  // refreshes near-expiry sessions and cryptographically verifies the JWT;
  // getSession() alone would trust forgeable cookie contents on the server.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
