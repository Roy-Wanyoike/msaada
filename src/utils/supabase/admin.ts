import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

/**
 * Server-only Supabase client for trusted account provisioning flows.
 *
 * The secret/service-role key must never be exposed through a NEXT_PUBLIC_*
 * variable. Normal login, signup, logout and session validation use the
 * cookie-aware publishable-key client from server.ts instead.
 */
export function createAdminClient() {
  const config = supabaseConfig();
  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!config || !secretKey) return null;

  return createClient(config.url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
