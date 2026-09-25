import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "./config";

/**
 * Session-refresh middleware step (called from src/proxy.ts on every matched
 * request).
 *
 * Supabase auth tokens live in cookies (sb-*). When they are expired, calling
 * getUser() triggers a refresh through the Supabase Auth server, and the SDK
 * hands back the Set-Cookie headers we must forward — otherwise a user with a
 * still-valid refresh token gets logged out mid-session.
 *
 * When Supabase isn't configured this is a strict pass-through: Msaada's own
 * msaada_session cookie auth (src/lib/auth.ts) is fully independent, and the
 * demo works without a Supabase project.
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
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and getUser() —
  // getUser() is what performs the token refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Msaada keeps its own route guard (msaada_session checked per route, see
  // src/lib/auth.ts). Supabase auth is additive; nothing is redirected here
  // yet. When Supabase Auth replaces the demo session, gate protected routes
  // on `user` at this point.
  void user;

  return supabaseResponse;
}
