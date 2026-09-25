# 19 — Fix Turbopack build warnings (docs/page.tsx)

**Labels:** `build`, `nextjs`

## Problem
The Vercel build log emits a Turbopack warning pointing at
`src/app/docs/page.tsx`. Build succeeds, but warnings hide real issues and
slow logs triage during the hackathon demo.

## Acceptance criteria
- [ ] Reproduce locally: `bun run build` (Turbopack) and capture any warning
      mentioning `docs/page.tsx`
- [ ] Fix the root cause (typical triggers: importing server-only modules
      into client components, barrel-file re-exports, dynamic import misuse)
- [ ] `bun run build` completes with zero warnings for `docs/page.tsx`
- [ ] Docs page still renders correctly (spot-check route `/docs`)

## Notes
- Commit message: `fix(build): resolve Turbopack warning in docs page (#19)`
