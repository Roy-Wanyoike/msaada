# 15 — Drop unused `z-ai-web-dev-sdk` dependency

**Labels:** `chore`, `dependencies`

## Problem
`package.json` still declares `z-ai-web-dev-sdk: ^0.0.18`, but `rg` finds
zero imports in `src/`. The AI client now talks to the ModelScope
OpenAI-compatible API directly (`src/lib/ai/client.ts`). The stale dep
confuses contributors and the README (which previously advertised it).

## Acceptance criteria
- [ ] Remove `z-ai-web-dev-sdk` from `package.json`
- [ ] Lockfile regenerated (`bun install`) with no other dependency drift
- [ ] `rg "z-ai" src/ package.json` → no hits (except docs mentioning history)
- [ ] `bun run build` + smoke test pass

## Notes
- Commit message: `chore(deps): drop unused z-ai-web-dev-sdk (#15)`
