# RPP-0257 conflict plan apply refusal, variant 3

Date: 2026-05-30
Lane: RPP-0257 conflict plan apply refusal, variant 3
Checklist item: RPP-0257 — Add generated coverage for conflict plan apply refusal, variant 3.

## Scope

This slice adds a focused generated Node proof for conflict-plan apply refusal. It does not change planner or executor production code, generated harness source, scenario-matrix rows, progress surfaces, release publish scripts, or unrelated checklist lines.

## Invariant

Every generated conflict plan must fail closed before mutation. The executor must reject the original non-ready plan with `PLAN_NOT_READY`, reject a forged ready status that keeps conflict evidence with `PLAN_INVARIANT_VIOLATION`, and reject stale replay attempts against any independent planned mutation with `PRECONDITION_FAILED`. Each refusal preserves the remote hash, calls no mutation hook, and writes no durable journal events.

## Evidence added

- Focused generated proof: `test/rpp-0257-conflict-plan-apply-refusal-v3.test.js`.
- The test filters deterministic generated harness cases to every `conflict` plan, then replays the selection to prove stable case and hash-only plan evidence.
- Coverage observed 201 generated conflict cases across tiers 0 through 9, with 1,567 planned independent mutations, 1,567 live-remote preconditions, 583 conflict records, and 44 stale mutation attempts.
- Conflict classes covered: `row-conflict`, `file-topology-conflict`, `file-conflict`, and `plugin-data-conflict`.
- For each case, the original conflict plan refuses with `PLAN_NOT_READY`; a forged ready status with retained conflict evidence refuses with `PLAN_INVARIANT_VIOLATION` and `READY_PLAN_HAS_CONFLICTS`; stale mutation attempts refuse with `PRECONDITION_FAILED`.

## Generated coverage aggregate

```json
{
  "target": "conflictPlanApplyRefusalVariant3",
  "totalConflictCases": 201,
  "totalPlannedMutations": 1567,
  "totalPlannedPreconditions": 1567,
  "totalConflicts": 583,
  "totalBlockers": 490,
  "totalStaleMutationAttempts": 44,
  "perTier": {
    "0": 14,
    "1": 16,
    "2": 16,
    "3": 19,
    "4": 19,
    "5": 24,
    "6": 23,
    "7": 23,
    "8": 23,
    "9": 24
  },
  "refusalCodes": {
    "PLAN_NOT_READY": 201,
    "PLAN_INVARIANT_VIOLATION": 201,
    "PRECONDITION_FAILED": 44
  }
}
```

## Redaction proof

The test serializes only status, summary counts, resource keys, classes, SHA-256 hashes, refusal codes, refusal detail hashes, and stale expected/actual hashes. It rejects raw-value evidence fields with `findEvidenceRedactionIssues()` and asserts serialized proof envelopes omit generated content, planned mutation payloads, and fixture strings selected from the base/local/remote snapshots.

## Validation commands

```sh
node --check test/rpp-0257-conflict-plan-apply-refusal-v3.test.js
node --test test/rpp-0257-conflict-plan-apply-refusal-v3.test.js
node --test --test-name-pattern='RPP-0217|RPP-0237' test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0257-conflict-plan-apply-refusal-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Local validation for this lane observed the focused RPP-0257 test with 1 subtest and 0 failures. Full release readiness remains gated by integration and broader release-verifier evidence outside this focused merge-invariant slice.
