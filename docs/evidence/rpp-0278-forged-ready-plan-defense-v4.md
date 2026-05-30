# RPP-0278 forged ready plan defense, variant 4

Date: 2026-05-30
Lane: RPP-0278 forged ready plan defense, variant 4
Release status: NO-GO until integration accepts the local commit.

## Claim

Forged ready plans that combine a missing live-remote precondition with invalid
hash material are refused before remote mutation and before durable-journal
output. Serialized evidence for the refusal uses hash-only summaries and
redacted invalid-hash metadata, so raw private fixture values do not appear in
that evidence envelope.

## Focused regression

- `test/rpp-0278-forged-ready-plan-defense-v4.test.js` builds a ready plan for a
  private local file update and verifies the planner emitted one live-remote
  precondition bound to the remote hash.
- The regression then forges the ready plan by replacing the mutation
  `remoteBeforeHash` with raw non-hash material and removing the matching
  live-remote precondition.
- `applyPlan` rejects the forged envelope with `PLAN_INVARIANT_VIOLATION`
  before durable journal events or mutation.
- The `REMOTE_BEFORE_HASH_INVALID` and `MISSING_LIVE_REMOTE_PRECONDITION`
  issues both expose only redacted invalid-hash metadata for the forged hash
  material.

## Redaction proof

The test serializes a constrained plan-evidence object containing status,
summary, resource keys, hash-field evidence, planned-value hashes, refusal
details, journal event types, and remote snapshot hashes. It asserts that the
serialized ready and forged evidence, plus the direct refusal details, omit all
private fixture values.

## Commands

```sh
node --check src/apply.js
node --check test/rpp-0278-forged-ready-plan-defense-v4.test.js
node --test --test-name-pattern=RPP-0278 test/rpp-0278-forged-ready-plan-defense-v4.test.js
```

Caveat: executable ready plans still carry mutation payloads. This proof covers
the serialized evidence envelope and refusal details, which intentionally use
hash-only summaries and redacted invalid-hash metadata.
