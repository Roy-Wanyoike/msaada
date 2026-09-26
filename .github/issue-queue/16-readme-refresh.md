# 16 — README: refresh tech stack, add Vercel env table + Supabase section

**Labels:** `docs`

## Problem
README line "Tech Stack" still says `Qwen (via z-ai-web-dev-sdk)` — the
client was migrated to the ModelScope OpenAI-compatible API
(`Qwen-Ambassador/Qwen3.8-Max`, hackathon: Hack for Humanity with Qwen).
There is also no deployment section: Vercel requires 6 env vars, and the
Supabase scaffolding (`src/utils/supabase/*`, `src/proxy.ts`,
`supabase/schema.sql`) is undocumented.

## Acceptance criteria
- [ ] Tech Stack line → `Next.js 16 (App Router, TypeScript) + Qwen (ModelScope OpenAI-compatible API) + Supabase (client helpers + session proxy) + Prisma + Tailwind CSS 4 + shadcn/ui + Recharts`
- [ ] New "Deployment (Vercel)" section with the env-var table:
      `DATABASE_URL`, `MSAADA_SESSION_SECRET`, `QWEN_API_KEY`, `QWEN_BASE_URL`,
      `QWEN_MODEL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
      (all "Server" except the two `NEXT_PUBLIC_*` which are Client/Server)
- [ ] New "Supabase" section: what the helpers do, `src/proxy.ts` session
      refresh (Next 16 proxy convention, replaces `middleware.ts`), and the
      instruction to run `supabase/schema.sql` in the Supabase SQL editor
- [ ] Note that ModelScope has no ASR model: `/api/transcribe` returns
      `501 ASR_NOT_AVAILABLE` and `QWEN_ASR_BASE_URL` (DashScope) is the
      documented escape hatch
- [ ] No real keys anywhere

## Notes
- Commit message: `docs(readme): ModelScope stack, Vercel env table, Supabase section (#16)`
