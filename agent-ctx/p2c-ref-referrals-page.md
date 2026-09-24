# Task ID: p2c-ref — referrals-page

## Agent
referrals-page

## Task
`/referrals` lifecycle page + AppNav link

## Work Log
- Read worklog.md, AppNav.tsx, identity-store.ts, identity-types.ts, api/referrals/route.ts, policy-engine.ts, prisma/schema.prisma, supervisor/page.tsx, report/mine/page.tsx for context.
- The ReferralDTO contract: { referralCode, category, priority, destination, status, createdAt, acknowledgedBy, acknowledgedAt, completedAt, followUpRequired, householdLabel, memberDisplayName } — verified in src/lib/identity-store.ts toReferralDTO.
- Authorized destinations come from `AUTHORIZED_DESTINATIONS` config in src/lib/policy-engine.ts (§12, §27 — NOT invented by AI). The page renders `r.destination ?? "Pending assignment"` — it never invents a facility.
- Edited src/components/msaada/AppNav.tsx:
  - Added `Stethoscope` to the lucide-react import block.
  - Inserted `{ href: "/referrals", label: "Referrals", icon: Stethoscope }` after Supervisor and before My report in NAV_ITEMS.
- Created src/app/referrals/page.tsx ('use client'):
  - AppNav at top, header "Referrals" + subtitle "Track referrals from creation to completion. 'Referral Created' ≠ 'Help Received' (§13)."
  - Summary strip: 4 cards (Total=teal, Pending=amber with hint "created → in_progress", Completed=emerald, Declined=red).
  - Filter bar: shadcn Select with all 9 options (all + 8 lifecycle states). Min-height 44px touch target.
  - Referral cards (motion staggered): row1 = referralCode + status badge with tone-coded palette (created=teal, sent=amber [blue-avoided per design rule], acknowledged=emerald, in_progress=amber, completed=emerald, declined=red, cancelled=muted, expired=red). Row2 = category badge + priority badge with icon (routine=teal Circle, urgent=amber AlertCircle, emergency=red Siren). Row3 = identity chain (householdLabel/memberDisplayName/destination) with semantic icons. Row4 = lifecycle timestamps (createdAt, acknowledgedBy+acknowledgedAt if present, completedAt if present, followUpRequired flag).
  - Loading: 4 Skeleton cards (h-40).
  - Empty state: contextual message (different for "all" vs filtered), CTA back to submission.
  - Error state: retry button.
  - Sticky footer (mt-auto).
  - `id="main"` on main, semantic HTML throughout, sr-only labels for screen readers, aria-labels on icon-only buttons.
- Palette: emerald/amber/orange/red/teal. NO indigo/blue anywhere — verified `sent` uses amber (NOT blue).
- Ran `bun run lint` → exit 0, zero errors.

## Stage Summary
- CHVs can track referrals from creation to completion.
