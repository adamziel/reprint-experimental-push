# RPP-0182 directory descendant conflict release verifier v5

Date: 2026-05-30
Lane: RPP-0182 directory descendant conflict release-verifier carry-through, variant 5
Checklist item: RPP-0182 - Carry through the release verifier for directory descendant conflict, variant 5.

## Scope

This adds local generated-harness release-verifier carry-through for the
directory descendant conflict target. The variant-5 target tag is emitted on
both ready directory-delete cases and non-ready cases where the remote creates a
descendant beneath the locally deleted directory.

The proof is local/support-only. It does not broaden the checked live production
boundary and final release posture remains NO-GO without separate
production-backed release evidence.

## Proof surface

`test/rpp-0182-directory-descendant-conflict-release-verifier-v5.test.js` proves
that the generated harness summary:

- exposes `directoryDescendantConflictReleaseVerifierVariant5` target coverage
  with 20 generated cases across tiers 0 through 9;
- includes 10 ready directory deletes and 10 non-ready descendant conflicts for
  the target;
- applies the ready directory delete, preserves remote-only data, and rejects
  stale replay with `PRECONDITION_FAILED` before mutation;
- carries non-ready remote descendant conflicts through `PLAN_NOT_READY`, with
  no conflicted directory mutation or precondition and an unchanged remote
  digest; and
- keeps selected evidence hash-only, excluding remote descendant payloads and
  raw content fields.

Observed deterministic target shape:

```json
{
  "totalCases": 620,
  "statuses": {
    "blocked": 74,
    "conflict": 201,
    "ready": 345
  },
  "directoryDescendantConflictReleaseVerifierVariant5": {
    "family": "directory-descendant-conflict-release-verifier-v5",
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
  }
}
```

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0182-directory-descendant-conflict-release-verifier-v5.test.js
node --test test/rpp-0182-directory-descendant-conflict-release-verifier-v5.test.js
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, directoryDescendantConflictReleaseVerifierVariant5: summary.targetCoverage.directoryDescendantConflictReleaseVerifierVariant5 }, null, 2));"
node --test --test-name-pattern='RPP-0142|RPP-0162|RPP-0182' test/generated-push-harness.test.js test/rpp-0182-directory-descendant-conflict-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0182-directory-descendant-conflict-release-verifier-v5.md
git diff --check
```

Observed focused result: RPP-0182 reported 2 subtests, 0 failures.

Observed summary result: 620 total cases; statuses `{ blocked: 74, conflict:
201, ready: 345 }`; `directoryDescendantConflictReleaseVerifierVariant5`
reported 20 cases, two cases in each tier 0 through 9, and statuses `{ conflict:
10, ready: 10 }`.
