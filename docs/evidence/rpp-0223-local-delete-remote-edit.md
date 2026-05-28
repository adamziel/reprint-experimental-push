# RPP-0223 local delete versus remote edit evidence

Date: 2026-05-28
Lane: RPP-0223 local delete versus remote edit, variant 2
Checklist item: RPP-0223 — Prove local delete versus remote edit, variant 2.

## Invariant

A local delete of a row that was edited on the remote after the pull base must fail closed as a conflict. The planner must not emit a mutation or precondition for that row. If other independent local mutations exist in the same plan, they may remain as hash-preconditioned audit evidence, but apply must refuse the whole non-ready plan before any mutation or durable journal write.

## Evidence added

- Focused planner/apply test: `RPP-0223 local delete versus remote edit refuses before mutation with redacted evidence`.
- Generated harness test: `RPP-0223 generated harness refuses local delete versus remote edit cases`.
- Generated target coverage records the existing `delete-edit-conflict` family and `delete-edit` tag across all complexity tiers.
- Scenario matrix row names the behavior, refusal command, and redaction caveat for integrators.

## Redaction and refusal proof

The focused test builds a private remote row title and a private independent local file value. It serializes only hash metadata, mutation identifiers, resource keys, precondition hashes, conflict classes, and decision metadata. Assertions prove the serialized proof omits both private raw values.

The same test proves the conflicted row has no mutation or precondition, while the independent file mutation remains live-remote-preconditioned for audit. Applying the conflict plan raises `PLAN_NOT_READY`, writes no durable journal events, and leaves both the remote row edit and the independent file target unchanged.

The generated test validates a deterministic `delete-edit-conflict` case, proves generated coverage across all tiers, confirms no mutation or precondition exists for the delete/edit row, and checks generated conflict/apply evidence omits the remote row value.

## Commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --check test/push-planner.test.js
node --test test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0223-local-delete-remote-edit.md docs/scenario-matrix.md
git diff --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0223 slice. It does not edit checklist or progress state and does not change the release verdict; release remains NO-GO until integrated release evidence accepts it.
