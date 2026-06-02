# Packaged source mutation guard evidence

Date: 2026-06-02
Lane: packaged production-shaped source mutation

## What changed

Packaged production-shaped apply now rejects lab-only controls before any
mutation-capable journal or write setup:

- `labFailAfterMutations`
- `labDriftAfterPrepared`
- `labDriftBeforeStorageWrite`
- `labSimulateMissingDbCommit`
- `labSimulateStaleClaimAllOld`
- `labSimulateStaleRetryAfterStarted`
- `labSimulateStaleRetryAfterClaim`
- `labOmitDbJournalTargetPlannedRows`
- `labDelayAfterStaleRetryClaimMs`
- `labDelayAfterIdempotencyOpenMs`
- `labDelayAfterDbJournalStartedMs`

The rejection is by presence, so `false`, `0`, or an empty object still fail in
packaged mode. The result code is `PACKAGED_LAB_CONTROL_REJECTED`, HTTP status
is `400`, and `mutationAttempted` is `false`.

The packaged snapshot route also ignores authenticated lab snapshot drift hooks
in package mode, preventing a read route from acting as a lab mutation trigger.

## Live packaged proof

The new package smoke scenario is `core-db-file-guarded-apply`, available
through the `source-mutation-guards` alias.

Command:

```sh
REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only \
REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=core-db-file-guarded-apply \
node ./scripts/playground/production-plugin-package-smoke.mjs
```

Observed result: pass.

The scenario starts a packaged Reprint Push plugin in WordPress Playground and
uses the production-shaped namespace `/wp-json/reprint/v1/push/*`. It proves:

- signed preflight returns a packaged production-shaped route profile with
  `labBacked=false`;
- a signed packaged apply body containing `labDriftBeforeStorageWrite` is
  rejected with `PACKAGED_LAB_CONTROL_REJECTED` and leaves the snapshot
  unchanged;
- a live `/snapshot` baseline is used to plan exactly two mutations:
  `row:["wp_posts","ID:1001"]` and
  `file:wp-content/uploads/reprint-push/shared.txt`;
- dry-run mints a receipt and apply commits both mutations;
- the `wp_posts` row write records `storageGuard.boundary` as
  `wpdb-single-statement-cas` with driver `wp-post`;
- the upload file write records `storageGuard.boundary` as
  `filesystem-compare-rename` with driver `fixture-upload-file`;
- DB journal readback reports checked live production-shaped journal scope,
  owned journal storage, restart readability, and lease fence boundary
  `wpdb-single-statement-cas`;
- same-key same-body apply replay returns `BATCH_ALREADY_COMMITTED` and
  `freshMutationWork=false`;
- same-key different-body apply conflict returns `IDEMPOTENCY_KEY_CONFLICT`,
  `freshMutationWork=false`, and does not mutate the final snapshot.

Observed smoke summary:

```json
{
  "packagedLabControlGuard": {
    "status": 400,
    "code": "PACKAGED_LAB_CONTROL_REJECTED",
    "mutationAttempted": false,
    "rejectedControls": ["labDriftBeforeStorageWrite"],
    "targetSnapshotUnchanged": true
  },
  "coreDbFileGuardedApply": {
    "planStatus": "ready",
    "mutationCount": 2,
    "resourceKeys": [
      "file:wp-content/uploads/reprint-push/shared.txt",
      "row:[\"wp_posts\",\"ID:1001\"]"
    ],
    "applyStatus": 200,
    "applied": 2,
    "freshMutationWork": true,
    "replayStatus": 200,
    "replayed": true,
    "replayFreshMutationWork": false,
    "conflictStatus": 409,
    "conflictCode": "IDEMPOTENCY_KEY_CONFLICT",
    "conflictFreshMutationWork": false,
    "finalMatchesLocal": true,
    "dbJournal": {
      "scope": "checked live production-shaped journal surface; not local Playground fixture only",
      "ownsJournal": true,
      "restartReadable": true,
      "leaseBoundary": "wpdb-single-statement-cas",
      "applyCommitted": true,
      "replayed": true,
      "conflict": true,
      "mutationAppliedForRequest": 2,
      "storageGuardBoundaries": [
        "filesystem-compare-rename",
        "wpdb-single-statement-cas"
      ]
    }
  }
}
```

## Verification

```sh
php -l scripts/playground/push-remote-rest-plugin.php
node --check scripts/playground/production-plugin-package-smoke.mjs
node --check scripts/playground/production-plugin-package-scenarios.js
node --test test/production-plugin-package-scenarios.test.js test/production-apply-route.test.js
REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only \
REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=core-db-file-guarded-apply \
node ./scripts/playground/production-plugin-package-smoke.mjs
```

## Remaining boundaries

This is real packaged WordPress route evidence for guarded source mutation, but
it is not a complete general production push proof. Remaining release-scope work
still includes generic plugin validator contracts, broader graph identity and
reference rewriting, large body streaming/chunking on the production source
endpoint, hosted/external smoke and soak evidence, and complete durable
transaction/recovery proof across every WordPress write boundary.
