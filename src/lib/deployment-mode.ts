/**
 * Demo-only capabilities are open during local development so the presentation
 * remains one-click. Production is closed unless an operator makes the risk an
 * explicit, temporary choice with MSAADA_DEMO_MODE=true.
 *
 * Besides the presentation conveniences (POST /api/demo-chv account
 * provisioning, POST /api/seed, self-signup), demo mode also enables the
 * LOCAL AUTH FALLBACK (issue #53): when Supabase is unconfigured,
 * /api/auth/login verifies against local scrypt hashes and issues a local
 * cookie session (src/lib/local-session.ts). Supabase always wins when
 * configured, so this flag never downgrades a Supabase deployment.
 *
 * Never expose this value to the browser: route handlers remain authoritative.
 */
export function isDemoMode(): boolean {
  const configured = process.env.MSAADA_DEMO_MODE?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV !== "production";
}
