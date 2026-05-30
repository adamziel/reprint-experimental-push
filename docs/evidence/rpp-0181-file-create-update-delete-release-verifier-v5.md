# RPP-0181 file create/update/delete release verifier v5

Date: 2026-05-30
Lane: RPP-0181 file create/update/delete mix release-verifier carry-through, variant 5
Checklist item: RPP-0181 - Carry through the release verifier for file create/update/delete mix, variant 5.

## Scope

This adds local generated-harness release-verifier carry-through for the file
create/update/delete mix. The variant-5 target tag is emitted on both generated
ready file-mix cases and generated non-ready conflict file-mix cases.

The proof is local/support-only. It does not broaden the checked live production
boundary and final release posture remains NO-GO without separate
production-backed release evidence.

## Proof surface

`test/rpp-0181-file-create-update-delete-release-verifier-v5.test.js` proves
that the release verifier:

- exposes `fileCreateUpdateDeleteMixReleaseVerifierVariant5` target coverage
  with 20 generated cases across tiers 0 through 9;
- includes 10 ready cases and 10 non-ready conflict cases for the target;
- applies the ready target create/update/delete file resources, preserves the
  remote-only file via `keep-remote`, and rejects stale replay with
  `PRECONDITION_FAILED` before mutation;
- carries non-ready update-file conflicts through apply refusal with
  `PLAN_NOT_READY`, no durable mutation events, and unchanged remote hashes; and
- keeps evidence hash-only, excluding generated file payloads, remote-only file
  payloads, concurrent remote update payloads, and stale replay sentinels.

Observed deterministic target shape:

```json
{
  "target": "fileCreateUpdateDeleteMixReleaseVerifierVariant5",
  "family": "file-create-update-delete-mix-release-verifier-v5",
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
```

## Validation commands

```sh
node --check test/rpp-0181-file-create-update-delete-release-verifier-v5.test.js
node --check scripts/harness/generated-push-cases.js
node --check scripts/playground/production-shaped-release-verify.mjs
node --test test/rpp-0181-file-create-update-delete-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0161|RPP-0181' test/generated-push-harness.test.js test/rpp-0181-file-create-update-delete-release-verifier-v5.test.js
node --test test/rpp-0281-independent-local-file-remote-row-release-verifier-v5.test.js test/rpp-0181-file-create-update-delete-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0181-file-create-update-delete-release-verifier-v5.md
git diff --check
```

Observed focused result: RPP-0181 reported 3 subtests, 0 failures.

Observed broader results after validation: syntax checks exited 0, the adjacent
RPP-0161 generated-harness slice exited 0, the adjacent RPP-0281 release-verifier
slice exited 0, the scoped artifact redaction scan returned `"ok": true`, and
`git diff --check` reported no whitespace errors.
