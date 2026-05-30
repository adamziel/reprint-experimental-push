# RPP-0615 same-key replay after rejection evidence

Date: 2026-05-30
Issue: RPP-0615
Lane: recovery

## Proof added

- The durable recovery release verifier now carries a dedicated
  `sameKeyReplayAfterRejection` check in the `GATE-2` proof.
- The check is proven only when the apply-revalidation leg is on the same
  checked durable recovery path, the original `/apply` rejection is
  `PRECONDITION_FAILED` before the first mutation, the same-key replay returns
  the same rejection with `replayed: true`, and the replay records no fresh
  mutation work. A separate preserved-remote retry caveat on the
  apply-revalidation leg does not weaken the recovery gate as long as the
  durable journal sub-boundary is accepted.
- The release proof also requires ordered DB journal evidence:
  `apply-rejected` precedes `apply-replayed`, no `apply-committed` row appears
  on the rejected path, and `mutationAppliedBeforeFailure` remains `0`.
- Focused coverage asserts both the positive path and the fail-closed case when
  the rejected replay is not reported on the same checked release boundary.

## Focused regression

`test/rpp-0615-same-key-replay-after-rejection.test.js` builds the same
release-verifier helper payload shape consumed by
`production-shaped-live-release-verify.mjs`:

1. A release summary proves the existing durable journal ownership, stale-owner
   fencing, claim expiry, committed replay, different-body conflict, old/new
   recovery states, and preserved rejected remote evidence.
2. The apply-revalidation summary adds the rejected same-key replay:
   status/code `412 PRECONDITION_FAILED`, `freshMutationWork: false`,
   preserved target surface, and ordered `apply-rejected` then
   `apply-replayed` journal rows.
3. The verifier reports `GATE-2`, `gateStatus: proven`, and
   `checks.sameKeyReplayAfterRejection: true` on the same checked recovery
   path, even when unrelated preserved-retry evidence remains a separate
   apply-revalidation caveat.
4. A negative fixture changes the apply-revalidation boundary verdict and proves
   the recovery gate fails closed instead of accepting replay evidence without
   an accepted durable journal sub-boundary.

## Validation run

```bash
node --test test/rpp-0615-same-key-replay-after-rejection.test.js test/recovery-journal.test.js test/recovery-repair.test.js
node --test --test-name-pattern 'durable recovery journal release proof binds|RPP-0615' test/production-shaped-proof.test.js test/rpp-0615-same-key-replay-after-rejection.test.js
node --test test/production-shaped-proof.test.js
REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH=/snapshot node ./scripts/playground/production-shaped-apply-revalidation-smoke.mjs > .tmp/rpp-0615-apply-revalidation.json
node --check scripts/playground/production-shaped-live-release-verify-lib.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0615-same-key-replay-after-rejection.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: focused recovery/release-verifier coverage exited 0,
`test/production-shaped-proof.test.js` exited 0 with 123 passing and 11 skipped
subtests, the apply-revalidation smoke exited 0 and reported
`PRECONDITION_FAILED` replay with ordered `apply-rejected`/`apply-replayed`
rows and no commit, syntax checking exited 0, checklist lint exited 0, the
evidence redaction scan exited 0, and `git diff --check` exited 0.
