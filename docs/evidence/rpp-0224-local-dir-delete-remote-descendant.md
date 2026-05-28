# RPP-0224 local directory delete versus remote descendant evidence

Date: 2026-05-28
Lane: RPP-0224 local directory delete versus remote descendant create, variant 2
Checklist item: RPP-0224 — Prove local directory delete versus remote descendant create, variant 2.

## Invariant

A local delete of a directory that would hide or remove a remote-created descendant must fail closed as a file topology conflict. The planner must not emit a mutation or precondition for the unsafe directory delete. Remote-created descendants remain keep-remote decisions, and any unrelated local mutation may stay in the plan only as hash-preconditioned audit evidence. Apply must refuse the non-ready plan before any target mutation or durable journal write.

## Evidence added

- Focused planner/apply test: `RPP-0224 local directory delete versus remote descendant create refuses with redacted evidence`.
- Generated harness test: `RPP-0224 generated directory descendant conflict refuses with hash-only evidence`.
- Generated target coverage reuses the existing `directory-descendant-conflict` family and `directory-delete-with-remote-descendant` tag across all complexity tiers.
- Scenario matrix row names the conflict/refusal behavior and the redaction caveat for integrators.

## Redaction and refusal proof

The focused test creates a private remote descendant file value plus a private independent local file value. It serializes proof evidence using only status, summary counts, mutation identifiers, resource keys, hashes, preconditions, decisions, and conflict metadata. Assertions prove the serialized proof, conflict evidence, and refusal details omit both private raw values.

The focused test also proves no mutation or precondition is emitted for the deleted directory, the remote descendant is represented as a keep-remote decision, the independent local file mutation remains live-remote-preconditioned for audit, and `applyPlan` raises `PLAN_NOT_READY` without durable journal events or target mutation.

The generated test validates a deterministic `directory-descendant-conflict` case, checks generated coverage across all tiers, proves no mutation or precondition exists for the unsafe directory delete, confirms the related remote descendant create is preserved as conflict metadata, and asserts generated hash-only evidence omits the descendant file content.

## Commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --check test/push-planner.test.js
node --test test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0224-local-dir-delete-remote-descendant.md docs/scenario-matrix.md
git diff --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0224 slice. It does not edit checklist or progress state and does not change the release verdict; release remains NO-GO until integrated release evidence accepts it.
