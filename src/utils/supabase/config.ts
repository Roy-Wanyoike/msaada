/**
 * Supabase configuration — lazy, call-time resolution.
 *
 * Both values are NEXT_PUBLIC_* (safe in the browser). Nothing here may throw
 * at module scope: modules that import this file get
 * evaluated during `next build` page-data collection, where a throw would
 * break every deploy that hasn't configured Supabase yet. Authentication
 * endpoints surface missing configuration as a controlled runtime response.
 */

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/**
 * Call-time variant for code paths that genuinely require Supabase (e.g. the
 * session-refresh proxy when auth cookies are present). Throws a clear error
 * instead of leaking raw env names into component stacks.
 */
export function requireSupabaseConfig(): SupabaseConfig {
  const config = supabaseConfig();
  if (!config) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }
  return config;
}
