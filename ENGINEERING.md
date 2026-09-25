# ENGINEERING.md — Msaada Operating Model Digest

This repository is built under a written **engineering operating model**. This file is the
in-repo digest every engineer and agent must follow. The source of record is the master
product/engineering conversation held with the product owner (ChatGPT share
`6ab6d1de-b8d0-83ea-98a3-a2c1c7664bf2`); where this digest and that transcript disagree,
the transcript wins and this file must be updated.

> **The golden rule:** no implementation without an issue, and no push directly to `main`.
> Every change travels: **issue → branch → PR → review → squash merge → issue closes.**

---

## 1. Issue discipline

### 1.1 Issue-first (§17)

No code is written for work that has no issue. The only exception is tiny repository
maintenance explicitly authorized by the Principal Engineering Lead. The full flow:

```text
Problem → Discovery → Specification → Issue → Dependency review → Assignment
        → Branch → Implementation → Tests → PR → Review → QA
        → Product acceptance → Merge → Issue closure
```

### 1.2 Issue types (§18)

Only standardized types. GitHub forms enforce the three that matter most; put the type in
the issue title for anything else:

| Type | Form | Typical use |
|---|---|---|
| BUG | `.github/ISSUE_TEMPLATE/bug_report.yml` | Something is broken |
| FEATURE | `.github/ISSUE_TEMPLATE/feature.yml` | New capability / enhancement |
| SECURITY | `.github/ISSUE_TEMPLATE/security.yml` | Vulnerabilities & abuse vectors |
| ARCHITECTURE / DATABASE / API / AI / QA / TECH-DEBT / CHORE | title prefix | Cross-cutting work |

### 1.3 Required fields (§19)

Every issue carries: Problem · User/system affected · Business value · Scope ·
Out of scope · Dependencies · Domain owner · API / Database / Event / Security / Privacy /
Offline / AI / Observability impact · **Acceptance criteria (Given/When/Then, observable —
§20)** · Testing requirements · Migration requirements · Rollback considerations ·
Documentation requirements.

### 1.4 Dependency rule (§21)

Every issue states **Depends on / Blocks / Related to**. Never start an issue whose
dependency is incomplete unless the dependency is a stable contract.

---

## 2. Branch & PR protocol

### 2.1 Branch strategy (§30–34)

```text
feature/MVP-<issue#>-short-description
fix/MVP-<issue#>-short-description
security/MVP-<issue#>-short-description
chore/MVP-<issue#>-short-description
```

- Branches are **short-lived** and come from a fresh `origin/main`: target is
  **1 issue = 1 branch = 1 PR = 1 merge**.
- Squash merge for normal feature PRs; commit titles read
  `MVP-<n> <imperative summary> (#<pr>)` — no `fix`, `update`, `final2`.
- **No direct pushes to `main`** (§34). Branch protection (PR required, review required,
  no force push, no deletion) is the repo owner's post-hackathon action item.

### 2.2 PR contents (§36)

The PR template (`.github/pull_request_template.md`) is mandatory. It captures:
Issue (`Closes #n`) · What changed · Why · Architecture impact · API / Database / Event /
Security / Privacy / Offline / AI impact · Tests · Manual validation · Screenshots ·
Migration · Rollback · Known limitations. Write **N/A** where a section genuinely does
not apply — do not delete sections.

Target **< 500 changed lines** (§35). A 2,000-line PR must justify why it was not
decomposed (exceptions: generated code, migrations, fixtures).

### 2.3 Self-review (§37)

Before requesting review the author confirms: issue requirements satisfied · no unrelated
changes · tests pass · no secrets · no debug logs · authorization verified · audit
requirements verified · error states handled · offline behavior handled · observability
added · documentation updated · API documented · migration safe · architecture compliant.

---

## 3. Review policy

- **Minimum review:** author + one qualified reviewer (§38). Agent-authored PRs are
  reviewed by a second, independent agent pass plus the human maintainer at merge.
- **Review priorities, in order (§39):** correctness → security → data integrity →
  safety → architecture → reliability → performance → maintainability → tests → style.
  Authentication changes additionally require a security reviewer; safety-workflow and
  database-architecture changes require the domain owner + principal engineer.
- **Comment levels (§41):** `BLOCKER` · `MUST FIX` · `SHOULD FIX` · `SUGGESTION` ·
  `QUESTION`. Only blockers and must-fix items prevent approval.
- **No rubber stamps (§42):** "LGTM" without understanding is invalid for critical PRs.

---

## 4. Quality gates & the one health command

Every PR runs, and must pass, the repository quality gate (§43–44):

```bash
npm run verify          # prisma generate → tsc --noEmit → eslint . → next build
npm run verify:smoke    # the above + boots the standalone server on a throwaway
                        # /tmp SQLite DB and probes /api/health, demo login, /presentation
```

- `verify` is the minimum bar for any PR; `verify:smoke` is required for anything that
  touches auth, bootstrap, routes, or the build output.
- Secret scanning happens at self-review (§37) and at merge; tokens live in
  git-ignored `.env.local` and are never echoed.
- GitHub Actions CI (`.github/workflows/ci.yml`) mirrors these gates on push/PR;
  where Actions is unavailable (see §7 exceptions) the local command is authoritative.

---

## 5. Definition of Ready / Done

**Ready (§45):** problem understood · scope defined · dependencies known · owner
identified · acceptance criteria written · architecture/API/data contracts understood ·
security impact identified.

**Done (§46):** code complete · tests complete · review complete · security reviewed ·
observability complete · audit complete where needed · documentation complete · product
accepted · QA passed · PR merged · issue closed.

---

## 6. Implementation order (§92) — current status

Phases are built in order; do not jump ahead of a stable contract.

| Phase | Scope | Status in this repo |
|---|---|---|
| 0 — Baseline | conventions, architecture, ADRs, issue backlog | **done** (issues #1–#21, this document) |
| 1 — Foundation | identity, organizations, authorization, device registration, audit, DB foundation | **done** — `ChvUser`/`Organization`/RBAC roles, `AuthSession`/`AuthEvent`/`PasswordResetToken`, audit log |
| 2 — Field workflow | households, people, assignments, encounters, offline storage, sync | **done for demo** — households → members → encounters with identity chain; Supabase draft-sync wired |
| 3 — AI | voice pipeline, STT, model abstraction, structured extraction, human review, evaluation | **done for demo** — Qwen abstraction + ASR degradation, structured triage, fallback + transparency fields |
| 4 — Safety & care | policy engine, routing, referrals, follow-ups, notifications | **done for demo** — deterministic policy engine, crisis override, referrals + follow-ups lifecycle |
| 5 — Intelligence | events, analytics pipeline, metrics, supervisor & county intelligence | **partial** — dashboards + community reporting & dispatch live; governed metric catalog pending |
| 6 — Early warning & learning | baselines, signals, explanations, evaluation datasets | **partial** — early-warning signals documented; learning loop pending |
| 7 — Hardening | security/load/failure testing, backup, observability, accessibility, DPIA, release validation | **partial** — agent security reviews, smoke/sim suites, self-bootstrapping DB done; load testing + DPIA pending |

---

## 7. Technology lock & current exceptions

**Locked stack (§50 of the model / §71 of the master prompt):** Next.js 16 (App Router,
TypeScript) · Prisma + SQLite (demo) with Supabase/Postgres mirror for sync tables ·
Qwen via ModelScope OpenAI-compatible API · Tailwind CSS 4 + shadcn/ui · Recharts · bun
as the canonical runner (npm kept working). ADRs (§89) are required to deviate.

**Documented exceptions (honesty over theater):**

1. **GitHub Actions is billing-locked** on the owner's account — local `npm run verify`
   is the authoritative gate until unlocked.
2. **Vercel demo mode** runs on a self-bootstrapping `/tmp` SQLite database; persistence
   across instances is explicitly out of scope for the demo tier (Supabase holds the
   synced layer).
3. **Branch protection is not yet configured** (owner-side setting). The no-direct-push
   rule is enforced by convention + agent discipline until then.
4. **Rotating credentials** (GitHub token, Qwen key) is scheduled after the hackathon
   window because they were exposed in chat during initial setup.

---

## 8. Where things live

| Artifact | Path |
|---|---|
| Issue forms (BUG/FEATURE/SECURITY) | `.github/ISSUE_TEMPLATE/` |
| PR template + self-review | `.github/pull_request_template.md` |
| Historical issue specs (closed) | `.github/issue-queue/` |
| CI workflow | `.github/workflows/ci.yml` |
| Quality gate | `scripts/verify.sh` (`npm run verify[:smoke]`) |
| Supabase schema mirror | `supabase/schema.sql` |
| Prisma schema (source of DDL) | `prisma/schema.prisma` |
| DB bootstrap + demo seed | `src/lib/db-bootstrap.ts`, `src/lib/demo-data-seed.ts` |
