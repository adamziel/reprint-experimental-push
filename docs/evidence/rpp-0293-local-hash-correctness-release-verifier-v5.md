# RPP-0293 LocalHash Correctness Release Verifier V5 Evidence

Date: 2026-05-31

Scope: local focused release-verifier support evidence only. The release remains
NO-GO until the broader live production-backed release boundary is satisfied.

## Proof Surface

- Adds `test/rpp-0293-local-hash-correctness-release-verifier-v5.test.js`
  as the variant 5 release-verifier carry-through for localHash correctness.
- Covers four focused fixtures: ready mixed file/row/plugin-owned row updates,
  ready file/row/plugin-owned row deletes, conflict with an independent safe
  mutation, and blocked unsupported plugin-owned data beside a safe mutation.
- Verifies each emitted mutation has a SHA-256 `localHash` matching the
  serialized planned value and, for non-rewritten resources, the local snapshot.
- Verifies ready apply carries the planned `localHash` to the resulting remote
  resource hash.
- Exercises forged ready plans with missing, raw invalid, wrong, stale-payload,
  stale-source, stale-delete, and resurrected-delete localHash variants. Each
  refusal fails before mutation and before durable journal writes.
- Replays every deterministic generated harness case and applies the raw
  invalid localHash refusal to every generated ready plan with mutations.
- Keeps support evidence hash-only: resource keys, counts, statuses, issue
  codes, and SHA-256 hashes are recorded while raw fixture payloads and raw row
  fields are rejected from the proof envelope.

## Observed Coverage

Focused release-verifier aggregate:

```json
{
  "totalCases": 4,
  "statuses": {
    "blocked": 1,
    "conflict": 1,
    "ready": 2
  },
  "totalMutations": 8,
  "totalConflicts": 1,
  "totalBlockers": 1,
  "totalPreconditions": 8,
  "totalRefusals": 8
}
```

Generated-harness aggregate:

```json
{
  "totalCases": 620,
  "statuses": {
    "ready": 345,
    "conflict": 201,
    "blocked": 74
  },
  "mutations": 8525,
  "localHashMatchesPlannedValue": 8525,
  "localHashMatchesLocalSnapshot": 8525,
  "graphIdentityMutations": 0,
  "readyCasesWithMutations": 344,
  "nonReadyCasesWithMutations": 246,
  "invalidLocalHashRefusals": 344,
  "familyCountWithMutations": 62
}
```

## Focused Verification Observed Locally

```sh
node --check test/rpp-0293-local-hash-correctness-release-verifier-v5.test.js
node --test test/rpp-0293-local-hash-correctness-release-verifier-v5.test.js
node --test test/rpp-0253-local-hash-correctness-v3.test.js test/rpp-0273-local-hash-correctness-v4.test.js test/local-hash-correctness-rpp-0213.test.js
node --test --test-name-pattern=RPP-0233 test/push-planner.test.js test/generated-push-harness.test.js
node --test test/rpp-0291-mutation-precondition-one-to-one-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0293-local-hash-correctness-release-verifier-v5.md
git diff --check
```

Observed result after validation: all commands exited 0. The focused RPP-0293
test reported 1 subtest ok, 0 failed. Adjacent localHash suites reported 5
subtests ok, 0 failed for RPP-0253/RPP-0273/RPP-0213, and 2 subtests ok, 0
failed for the RPP-0233 planner/generated harness filter. The adjacent RPP-0291
release-verifier pattern test reported 1 subtest ok, 0 failed. The scoped
artifact redaction scan returned `"ok": true` for this evidence doc.

## Release Posture

This is support-only local release-verifier evidence. It does not claim a
production-backed release pass, does not update progress artifacts, and does
not replace the broader release checklist or CI evidence.
