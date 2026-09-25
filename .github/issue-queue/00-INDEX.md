# Issue Queue — Msaada (2026-09-26)

GitHub-ready issues drafted by the engineering review. When a token with
`repo` scope is available, post each file to GitHub via
`POST /repos/Roy-Wanyoike/msaada/issues` (title = first heading, body = rest)
and close with the matching fix commit (`Fixes #NN`).

Numbering continues from the previously closed batch (#9–#13).

| # | Title | Branch | Status |
|---|---|---|---|
| 14 | Repo hygiene: untrack internal tooling, logs, binary DB, stale lockfile | feat/issue-14-hygiene | drafted |
| 15 | Drop unused `z-ai-web-dev-sdk` dependency | feat/issue-14-hygiene | drafted |
| 16 | README: refresh tech stack, add Vercel env table + Supabase section | feat/issue-16-docs | drafted |
| 17 | `/api/health` endpoint + `/status` demo page (Qwen / Supabase / DB) | feat/issue-17-health | drafted |
| 18 | Wire Supabase into offline-first encounter draft sync | feat/issue-18-sync | drafted |
| 19 | Fix Turbopack build warnings (docs/page.tsx) | feat/issue-16-docs | drafted |

Security note (applies to all): real API keys live only in git-ignored
`.env.local`. Issue files, commits, and code must contain placeholders only.
