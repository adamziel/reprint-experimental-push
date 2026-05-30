# RPP-0372 termmeta term reference v4 evidence

Date: 2026-05-30

## Scope

This is focused local regression coverage for `wp_termmeta.term_id` graph
references to `wp_terms` rows. It adds only a new Node test and this evidence
note, and it does not change shared planner code, generated harness files,
release verifier artifacts, auth, recovery, storage, or public progress
surfaces.

## Proof surface

`test/rpp-0372-termmeta-term-reference-v4.test.js` proves two fail-closed
planner paths for variant 4:

- a new termmeta row whose `term_id` points at a missing `wp_terms` target is
  blocked as `stale-wordpress-graph-identity` with no planned mutations;
- a new termmeta row whose `term_id` points at a term row that drifted remotely
  is also blocked, while the term target is kept remote; and
- both blockers expose only resource keys, relationship metadata, states, and
  SHA-256 hashes for the termmeta and target term surfaces. Raw term names,
  slugs, meta keys, and meta values are checked for absence from blocker and
  redacted local evidence.

The focused tests also call `applyPlan()` on each non-ready plan and assert
`PLAN_NOT_READY` with an unchanged remote digest, proving refusal before any
remote mutation.

## Focused verification observed locally

```sh
node --check test/rpp-0372-termmeta-term-reference-v4.test.js
node --test test/rpp-0372-termmeta-term-reference-v4.test.js
grep -RInE "termmeta|term reference|RPP-0312|RPP-0332|RPP-0352" test
node --test --test-name-pattern='termmeta|term reference|RPP-0312|RPP-0332|RPP-0352' test/push-planner.test.js test/generated-push-harness.test.js test/graph-mapping-inventory.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0372-termmeta-term-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: the commands above exited 0. The focused RPP-0372 file reported
two subtests ok and zero failures. The adjacent termmeta/term graph slice
reported five subtests ok and zero failures. Checklist lint returned `"ok":
true`; the scoped artifact redaction scan returned `"ok": true`; both staged
and unstaged diff checks returned no whitespace errors.

## Release posture

This is local planner regression evidence only. It is not a production-backed
proof and does not change the broader release posture.
