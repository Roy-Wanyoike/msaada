"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "./config";

/**
 * Browser-side Supabase client (Client Components). Returns null when
 * Supabase isn't configured so consumers can surface a controlled setup error
 * instead of failing at module evaluation time.
 *
 * createBrowserClient memoizes a singleton internally, so calling this in
 * multiple components does not create multiple GoTrue clients.
 */
export function createClient() {
  const config = supabaseConfig();
  if (!config) return null;

  return createBrowserClient(config.url, config.publishableKey);
}
