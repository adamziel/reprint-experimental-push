# RPP-0242 independent local row plus remote file edit variant 3 evidence

Date: 2026-05-30
Lane: RPP-0242 independent local row plus remote file edit, variant 3
Checklist item: RPP-0242 — Add generated coverage for independent local row plus remote file edit, variant 3.

## Scope

This slice stays inside local Node planner/apply proof for generated merge-invariant fixtures. It does not change planner semantics, shared generated harness files, plugin-driver verifier files, executor-auth routes, recovery journal code, storage/performance code, public progress surfaces, or supervisor reports.

## Invariant

Generated cases where a local `wp_posts` row edit coexists with an independent remote file edit must stay safe to apply. The row is the planned mutation and has a live-remote precondition. The remote file remains a hash-only `keep-remote` decision with no mutation and no file precondition. Forging a file mutation into that ready plan must be rejected before mutation, and stale row replay must fail before mutation.

## Evidence added

- Focused generated proof: `test/rpp-0242-independent-local-row-remote-file-v3.test.js`.
- The proof recounts the deterministic generated `independent-local-row-remote-file` cases across tiers 0 through 9 and verifies all ten target cases are ready.
- For each generated case, the proof checks the target row mutation, the target remote-file `keep-remote` decision, one live-remote precondition per planned mutation, preservation of the remote file after apply, and hash-only serialized proof data.
- The forged path injects a file mutation and live precondition for the remote-only file. The executor rejects the tampered ready plan with `PLAN_INVARIANT_VIOLATION` and `MUTATION_DECISION_RESOURCE_OVERLAP`, leaves the remote unchanged, and writes no durable events.
- The stale path changes the generated local-row target after planning. The executor rejects with `PRECONDITION_FAILED`, leaves the remote unchanged, preserves the independent remote file, and writes no durable events.

## Generated target shape

The local proof records this hash-only coverage envelope:

```json
{
  "target": "independentLocalRowRemoteFileVariant3",
  "family": "independent-local-row-remote-file",
  "total": 10,
  "perTier": {
    "0": 1,
    "1": 1,
    "2": 1,
    "3": 1,
    "4": 1,
    "5": 1,
    "6": 1,
    "7": 1,
    "8": 1,
    "9": 1
  },
  "statuses": {
    "ready": 10
  }
}
```

Case-level proof data keeps resource keys, plan hashes, row precondition hashes, remote file decision hashes, refusal codes, issue codes, and unchanged remote hashes. Generated row titles, generated remote file payloads, forged file payloads, and stale row titles are asserted absent from serialized evidence and refusal details.

## Validation commands

```sh
node --check test/rpp-0242-independent-local-row-remote-file-v3.test.js
node --test test/rpp-0242-independent-local-row-remote-file-v3.test.js
node --test --test-name-pattern='RPP-0202|RPP-0222' test/push-planner.test.js
node --test --test-name-pattern='RPP-0222 generated harness preserves independent local rows and remote files' test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0242-independent-local-row-remote-file-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Local validation for this lane observed the focused RPP-0242 test with 1 subtest and 0 failures, adjacent row/file planner coverage with 3 subtests and 0 failures, adjacent generated harness coverage with 1 subtest and 0 failures, checklist lint `ok: true`, and scoped artifact redaction scan `ok: true`. Full release readiness remains gated by integration and release-verifier evidence outside this focused merge-invariant slice.
