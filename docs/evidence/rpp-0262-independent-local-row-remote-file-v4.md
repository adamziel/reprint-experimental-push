# RPP-0262 independent local row plus remote file edit variant 4 evidence

Date: 2026-05-30
Lane: RPP-0262 independent local row plus remote file edit, variant 4
Checklist item: RPP-0262 — Add focused regression coverage for independent local row plus remote file edit, variant 4.

## Scope

This slice adds a focused local Node planner/apply regression. It does not change planner or executor semantics, generated harness sources, scenario matrix rows, progress surfaces, release publish scripts, or unrelated checklist lines.

## Invariant

A focused fixture with one local `wp_posts` row edit and one independent remote file edit must apply only the row. The remote file remains a hash-only `keep-remote` decision with no file mutation and no file precondition. A forged file mutation targeting that kept-remote file must be rejected before mutation, and a stale row replay must fail before mutation.

## Evidence added

- Focused proof: `test/rpp-0262-independent-local-row-remote-file-v4.test.js`.
- The proof checks the ready plan shape: one row mutation, one file `keep-remote` decision, one live-remote precondition for the row, no file mutation, and no file precondition.
- The successful apply writes durable mutation evidence only for the row resource and preserves the remote file payload.
- The forged path injects a file mutation and matching live-remote precondition while the file remains a `keep-remote` decision. The executor rejects the tampered ready plan with `PLAN_INVARIANT_VIOLATION` and `MUTATION_DECISION_RESOURCE_OVERLAP`, leaves the remote unchanged, and writes no durable events.
- The stale path changes the planned row after dry run. The executor rejects with `PRECONDITION_FAILED`, leaves the remote unchanged, preserves the independent remote file, and writes no durable events.

## Hash-only proof shape

```json
{
  "target": "RPP-0262 focused independent local row plus remote file edit variant 4",
  "summary": {
    "mutations": 1,
    "decisions": 1,
    "conflicts": 0,
    "blockers": 0,
    "atomicGroups": 0
  },
  "successMutationEvents": [
    ["target-planned", "row:[\"wp_posts\",\"ID:262\"]"],
    ["mutation-observed", "row:[\"wp_posts\",\"ID:262\"]"]
  ],
  "forged": {
    "code": "PLAN_INVARIANT_VIOLATION",
    "issueCode": "MUTATION_DECISION_RESOURCE_OVERLAP"
  },
  "stale": {
    "code": "PRECONDITION_FAILED"
  }
}
```

Case-level assertions keep only resource keys, summary counts, hashes, refusal codes, and durable event types in serialized proof data. The focused row payloads, remote file payload, forged file payload, and stale row payload are asserted absent from serialized evidence and refusal details.

## Validation commands

```sh
node --check test/rpp-0262-independent-local-row-remote-file-v4.test.js
node --test test/rpp-0262-independent-local-row-remote-file-v4.test.js
node --test test/rpp-0242-independent-local-row-remote-file-v3.test.js
node --test --test-name-pattern='RPP-0202|RPP-0222' test/push-planner.test.js
node --test --test-name-pattern='RPP-0222 generated harness preserves independent local rows and remote files' test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0262-independent-local-row-remote-file-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Local validation observed the focused RPP-0262 test with 1 subtest and 0 failures, adjacent independent row/file coverage with 4 subtests and 0 failures, generated RPP-0222 row/file coverage with 1 subtest and 0 failures, checklist lint `ok: true`, scoped artifact redaction scan `ok: true`, and clean staged/unstaged whitespace checks. Full release readiness remains gated by integration and release-verifier evidence outside this focused merge-invariant slice.
