/**
 * Role-based access control (RBAC) taxonomy + predicate helpers.
 *
 * ChvUser.role carries one of the nine institutional roles below (see
 * prisma/schema.prisma). Route handlers MUST resolve a session first
 * (getSessionChv / requireChvSession) and then use these predicates to
 * decide authorization — role strings are never compared ad-hoc inline.
 *
 * Authorization rationale (Kenya community-health hierarchy):
 *  - chv owns their own households/records (no aggregate visibility).
 *  - cho_supervisor oversees CHVs in a sub-county → sees rosters/briefings.
 *  - subcounty_admin / county_admin run county operations.
 *  - moh_officer / moh_admin are national — program oversight + compliance.
 *  - program_admin manages partner programs (county-or-above reporting).
 *  - system_admin is the platform operator (technical, all counties).
 *  - auditor is a compliance observer: read-only audit trail access but no
 *    operational dashboards.
 *  - system_admin/moh_admin see across all counties (NATIONAL_ROLES in
 *    src/lib/community-report-types.ts stay in sync conceptually).
 */

/** The complete role taxonomy (kept in sync with prisma/schema.prisma). */
export const ROLES = [
  "moh_admin",
  "moh_officer",
  "county_admin",
  "subcounty_admin",
  "cho_supervisor",
  "chv",
  "program_admin",
  "auditor",
  "system_admin",
] as const;

export type Role = (typeof ROLES)[number];

/** Roles that administer a county or national scope (operational oversight). */
const COUNTY_OR_ABOVE: ReadonlySet<string> = new Set([
  "county_admin",
  "subcounty_admin",
  "moh_admin",
  "moh_officer",
  "program_admin",
  "system_admin",
]);

/** Roles allowed to view the compliance audit trail. */
const AUDIT_VIEWERS: ReadonlySet<string> = new Set([
  "auditor",
  "moh_admin",
  "moh_officer",
  "county_admin",
  "program_admin",
  "system_admin",
]);

/**
 * Any administrative/system role (everything except field roles).
 * Rationale: an "admin" gate is the coarsest guard for platform-management
 * surfaces (user administration, organization setup) where any
 * institutional administrator may look, but field roles (chv,
 * cho_supervisor) and the read-only auditor must not.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return (
    role === "moh_admin" ||
    role === "moh_officer" ||
    role === "county_admin" ||
    role === "subcounty_admin" ||
    role === "program_admin" ||
    role === "system_admin"
  );
}

/**
 * County-or-above: may see county-level (or all-county) aggregates.
 * Rationale: aggregate dashboards expose cross-CHV workload patterns —
 * safe for officials who already hold county-wide oversight (county_admin,
 * subcounty_admin, national roles, program_admin, system_admin), but NOT
 * for a single CHV (must stay on ?scope=mine) and NOT for cho_supervisor,
 * whose legitimate view is the de-identified supervisor roster, not the
 * full county aggregate surface, and NOT for auditor (compliance observer
 * only). cho_supervisor is deliberately excluded — use
 * isSupervisorOrAbove for roster-style surfaces instead.
 */
export function isCountyOrAbove(role: string | null | undefined): boolean {
  return COUNTY_OR_ABOVE.has(role ?? "");
}

/**
 * Supervisor-or-above: may view per-CHV de-identified rosters/ops.
 * Rationale: roster rows are per-CHV aggregates (never PII) and are exactly
 * what a cho_supervisor needs to manage their volunteers; every
 * county-or-above role is a superset of that need. A plain chv must never
 * see peers' workload.
 */
export function isSupervisorOrAbove(role: string | null | undefined): boolean {
  return role === "cho_supervisor" || isCountyOrAbove(role);
}

/**
 * May view the compliance audit trail.
 * Rationale: the audit log is the system of record for safety incidents —
 * de-identified but sensitive (actor labels, verdicts, escalation flags).
 * Access is granted to compliance/oversight roles (auditor, national
 * officers, county and program admins, system_admin). Field roles (chv,
 * cho_supervisor, subcounty_admin) are excluded: subcounty_admin is an
 * operations role without compliance mandate; auditors get the trail but
 * deliberately nothing else.
 */
export function canViewAudit(role: string | null | undefined): boolean {
  return AUDIT_VIEWERS.has(role ?? "");
}
