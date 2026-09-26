/**
 * Demo-only capabilities are open during local development so the presentation
 * remains one-click. Production is closed unless an operator makes the risk an
 * explicit, temporary choice with MSAADA_DEMO_MODE=true.
 *
 * Never expose this value to the browser: route handlers remain authoritative.
 */
export function isDemoMode(): boolean {
  const configured = process.env.MSAADA_DEMO_MODE?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV !== "production";
}
