# RPP-0183 file type-swap conflict release verifier v5

Date: 2026-05-30
Lane: RPP-0183 file type-swap conflict release-verifier carry-through, variant 5
Checklist item: RPP-0183 - Carry through the release verifier for file type-swap conflict, variant 5.

## Scope

This adds local generated-harness release-verifier carry-through for the file
type-swap conflict target. The variant-5 target tag is emitted on both ready
directory-to-file swap cases and non-ready cases where the remote creates a
descendant beneath the swapped directory.

The proof is local/support-only. It does not broaden the checked live
production boundary and final release posture remains NO-GO without separate
production-backed release evidence.

## Proof surface

`test/rpp-0183-file-type-swap-conflict-release-verifier-v5.test.js` proves that
the generated harness summary:

- exposes `fileTypeSwapConflictReleaseVerifierVariant5` target coverage with
  20 generated cases across tiers 0 through 9;
- includes 10 ready directory-to-file swaps and 10 non-ready remote-descendant
  conflicts for the target;
- applies every ready variant-5 case, preserves unplanned remote resources
  without overwrite, and rejects stale replay with `PRECONDITION_FAILED` before
  mutation;
- carries non-ready remote descendant conflicts through `PLAN_NOT_READY`, with
  no conflicted target mutation or precondition and an unchanged remote digest;
  and
- keeps selected evidence hash-only, excluding raw file content and remote
  descendant payloads.

Observed deterministic target shape:

```json
{
  "totalCases": 620,
  "statuses": {
    "blocked": 74,
    "conflict": 201,
    "ready": 345
  },
  "fileTypeSwapConflictReleaseVerifierVariant5": {
    "family": "file-type-swap-conflict-release-verifier-v5",
    "total": 20,
    "perTier": {
      "0": 2,
      "1": 2,
      "2": 2,
      "3": 2,
      "4": 2,
      "5": 2,
      "6": 2,
      "7": 2,
      "8": 2,
      "9": 2
    },
    "statuses": {
      "conflict": 10,
      "ready": 10
    }
  },
  "readyBehavior": {
    "readyCases": 10,
    "readyApplied": 10,
    "readyUnplannedRemotePreserved": 10,
    "readyStaleReplayRejected": 10
  }
}
```

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0183-file-type-swap-conflict-release-verifier-v5.test.js
node --test test/rpp-0183-file-type-swap-conflict-release-verifier-v5.test.js
node --input-type=module -e "import { generatePushHarnessCases, runGeneratedPushHarness, validateGeneratedCase } from './scripts/harness/generated-push-cases.js'; const tag = 'file-type-swap-conflict-release-verifier-v5'; const cases = generatePushHarnessCases().filter((testCase) => testCase.tags.has(tag)); const validations = cases.map((testCase) => validateGeneratedCase(testCase)); const ready = validations.filter((result) => result.status === 'ready'); const summary = runGeneratedPushHarness().summary; console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, fileTypeSwapConflictReleaseVerifierVariant5: summary.targetCoverage.fileTypeSwapConflictReleaseVerifierVariant5, readyBehavior: { readyCases: ready.length, readyApplied: ready.filter((result) => result.applied).length, readyUnplannedRemotePreserved: ready.filter((result) => result.unplannedRemotePreserved).length, readyStaleReplayRejected: ready.filter((result) => result.staleReplayRejected && result.staleReplayRejectionCode === 'PRECONDITION_FAILED' && result.staleReplayRemoteUnchanged).length } }, null, 2));"
node --test --test-name-pattern='RPP-0163|RPP-0183' test/generated-push-harness.test.js test/rpp-0183-file-type-swap-conflict-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0183-file-type-swap-conflict-release-verifier-v5.md
git diff --check
```

Observed focused result: RPP-0183 reported 2 subtests, 0 failures.

Observed summary result: 620 total cases; statuses `{ blocked: 74, conflict:
201, ready: 345 }`; `fileTypeSwapConflictReleaseVerifierVariant5` reported 20
cases, two cases in each tier 0 through 9, statuses `{ conflict: 10, ready: 10
}`, and ready behavior `{ readyCases: 10, readyApplied: 10,
readyUnplannedRemotePreserved: 10, readyStaleReplayRejected: 10 }`.
