# RPP-0232 remoteBeforeHash correctness, variant 2

Date: 2026-05-28
Lane: RPP-0232 remoteBeforeHash correctness, variant 2
Release status: NO-GO until integration accepts the session branch.

## Claim

Every ready mutation must carry a `remoteBeforeHash` matching the exact live
remote resource snapshot covered by its live-remote precondition. Forged plans
that change the mutation hash, change the precondition hash, or replay against a
stale remote are refused before mutation.

## Evidence added

- `test/push-planner.test.js` adds a focused mixed fixture covering a file,
  a core row, and an allowlisted plugin-owned option. It proves the planner binds
  each mutation hash to the live remote resource and the executor rejects:
  mismatched mutation/precondition hashes, matching-but-wrong hashes, malformed
  raw hash fields, and stale live remotes.
- `scripts/harness/generated-push-cases.js` keeps blocker-propagation generated
  cases valid while preserving the no-unplanned-mutation contract.
- `test/generated-push-harness.test.js` samples generated ready fixtures across
  file, row, post, and plugin-option families. For each generated fixture, it
  checks the live remote hash binding and proves a forged `remoteBeforeHash`
  fails before mutation.
- `src/apply.js` now reports malformed hash evidence as structured state plus a
  digest, so refusal details keep useful reason codes without echoing raw values.

## Commands

```sh
node --check src/apply.js
node --check scripts/harness/generated-push-cases.js
node --check test/push-planner.test.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0232 test/push-planner.test.js
node --test --test-name-pattern=RPP-0232 test/generated-push-harness.test.js
node --test test/generated-push-harness.test.js
node --test test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0232-remote-before-hash-correctness-v2.md docs/evidence audits progress.html
git diff --check
```

Caveat: full ready plans may contain mutation payloads for execution. The proof
serializes only hash-only evidence envelopes for release artifacts and asserts
private fixture values and mutation payloads are absent from refusal evidence.
