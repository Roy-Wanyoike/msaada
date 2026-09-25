"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "./config";

/**
 * Browser-side Supabase client (Client Components). Returns null when
 * Supabase isn't configured — the app keeps working on Msaada's own session
 * auth, and Supabase features light up only where configured.
 *
 * createBrowserClient memoizes a singleton internally, so calling this in
 * multiple components does not create multiple GoTrue clients.
 */
export function createClient() {
  const config = supabaseConfig();
  if (!config) return null;

  return createBrowserClient(config.url, config.publishableKey);
}
