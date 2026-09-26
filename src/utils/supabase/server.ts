import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

/**
 * Server-side Supabase client (Server Components, Server Actions, Route
 * Handlers). Returns null when Supabase isn't configured so callers can fall
 * back to Msaada's own cookie-session auth without branching at import time.
 *
 * Cookie strategy follows the @supabase/ssr docs: read the whole cookie store
 * for the token refresh, and write every Set-Cookie the SDK emits back.
 */
export async function createClient() {
  const config = supabaseConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — cookies can't be mutated there.
          // The session-refresh proxy refreshes expired tokens before they
          // reach a Server Component, so this is safe to ignore.
        }
      },
    },
  });
}
