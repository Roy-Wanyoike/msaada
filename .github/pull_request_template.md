<!--
Msaada engineering operating model — §36 PR TEMPLATE + §37 SELF-REVIEW.
Every section is required; write "N/A" where a section genuinely does not apply.
Reviewers examine in the §39 order: correctness → security → data integrity →
safety → architecture → reliability → performance → maintainability → tests → style.
-->

## Issue

Closes #XXX

<!-- 1 issue = 1 branch = 1 PR = 1 merge (§32). Direct pushes to main are forbidden (§34). -->

## What changed

## Why

## Architecture impact

<!-- Which bounded contexts / layers are touched? Any drift risk vs the master architecture? -->

## API changes

<!-- None, or list endpoints/DTOs added/changed/removed + versioning notes (§29) -->

## Database changes

<!-- None, or schema changes, migration strategy, index impact (§25, §59) -->

## Event changes

<!-- None, or events added/changed/removed + versioning notes (§28) -->

## Security impact

<!-- Authn/authz, secrets, attack surface, rate limits, session handling (§31, §60) -->

## Privacy impact

<!-- PII/PHI exposure, de-identification invariants, data minimization, retention (§49–52) -->

## Offline impact

<!-- Offline-first behavior, queue/sync effects, conflict handling (§20–22) -->

## AI impact

<!-- Model calls, prompt changes, safety policy interaction, fallback behavior (§16, §62) -->

## Tests

<!-- What automated tests cover this change; how they were run -->

## Manual validation

<!-- What was verified by hand, on which environment -->

## Screenshots

<!-- Before/after for UI changes; "N/A" if none -->

## Migration

<!-- Migration steps needed at deploy time; "None" if not applicable -->

## Rollback

<!-- How to revert safely in production; feature-flag? (§57, §58) -->

## Known limitations

---

### Author self-review (§37 — check before requesting review)

- [ ] Issue requirements satisfied
- [ ] No unrelated changes
- [ ] Tests pass
- [ ] No secrets
- [ ] No debug logs
- [ ] Authorization verified
- [ ] Audit requirements verified
- [ ] Error states handled
- [ ] Offline behavior handled
- [ ] Observability added
- [ ] Documentation updated
- [ ] API documented
- [ ] Migration safe
- [ ] Architecture compliant
