# RPP-0258 forged ready plan defense variant 3 evidence

Date: 2026-05-30
Lane: RPP-0258 forged ready plan defense, variant 3
Checklist item: RPP-0258 — Add generated coverage for forged ready plan defense, variant 3.

## Scope

This slice adds generated Node coverage for executor-side forged ready-plan refusal and hash-only evidence serialization. It avoids progress surfaces, generated harness source, scenario matrix rows, release publish scripts, and unrelated checklist lines.

## Invariant

For generated ready-candidate plans, each mutation must have exactly one matching `live-remote` precondition. Forged ready plans that remove or duplicate those preconditions, inject raw private material into hash evidence, or forge raw private payloads must be refused before remote mutation and before durable target or mutation evidence. Serialized plan evidence and refusal details must omit every raw private fixture value used by the generated case, forged hash, forged payload, and stale live-remote drift.

## Evidence added

- `test/rpp-0258-forged-ready-plan-defense-v3.test.js` filters the deterministic generated harness to the 170 `ready-candidate` cases.
- Coverage spans tiers 0 through 9 and 18 generated families, including file, row, option, graph, plugin-owned, and large-ready-plan surfaces.
- For each generated ready candidate, the test verifies the generated apply contract, confirms one live-remote precondition per mutation, serializes a hash-only baseline envelope, and exercises these refusal paths:
  - missing live-remote precondition plus raw private forged `remoteBeforeHash` material;
  - duplicate live-remote precondition;
  - raw private forged mutation payload; and
  - stale live-remote private drift.
- Refusals assert `PLAN_INVARIANT_VIOLATION` or `PRECONDITION_FAILED`, zero applied mutations, unchanged remote hash, no durable events for forged plans, and no stale target/mutation durable events.

## Redaction hardening

`src/apply.js` now reports `MISSING_LIVE_REMOTE_PRECONDITION.expectedHash` through the same hash-evidence redactor used by other ready-plan hash fields. This closes the generated forged case where an attacker removes the precondition and also replaces `remoteBeforeHash` with raw private material.

## Hash-only serialization proof

The test evidence envelope records only case metadata, status counts, resource keys, hash metadata, planned-value hashes, refusal codes, issue-code sets, journal event types, and remote hashes. Raw mutation payloads and raw stale values are reduced to digests before serialization. Assertions check the serialized envelope and `error.details` against generated private values and injected private values for every generated case.

## Validation commands

```sh
node --check src/apply.js
node --check test/rpp-0258-forged-ready-plan-defense-v3.test.js
node --test test/rpp-0258-forged-ready-plan-defense-v3.test.js
node --test --test-name-pattern='RPP-0218|RPP-0238' test/push-planner.test.js test/rpp-0238-forged-ready-plan-defense-v2.test.js
node --test test/rpp-0238-forged-ready-plan-defense-v2.test.js test/rpp-0239-redacted-raw-value-evidence-v2.test.js test/evidence-redaction.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0258-forged-ready-plan-defense-v3.md docs/reprint-push-completion-checklist.md
node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js
git diff --check
git diff --cached --check
```

Focused local validation for this lane observed the RPP-0258 generated test with 1 subtest and 0 failures. Broader release readiness remains governed by integration and release-verifier evidence outside this focused merge-invariant slice.
