# RPP-0243 local delete versus remote edit variant 3 evidence

Date: 2026-05-30
Lane: RPP-0243 local delete versus remote edit, variant 3
Checklist item: RPP-0243 — Add generated coverage for local delete versus remote edit, variant 3.

## Invariant

Generated local-delete versus remote-edit cases must fail closed as conflicts. The generated target row must have no mutation and no live-remote precondition, unrelated generated mutations must remain hash-preconditioned for audit, and apply must refuse the non-ready plan before mutating remote state. Serialized proof evidence must contain only hashes, resource keys, counts, and conflict metadata, never the generated base or remote row titles.

## Evidence added

- Focused generated proof: `test/rpp-0243-local-delete-remote-edit-v3.test.js`.
- Test name: `RPP-0243 generated local delete versus remote edit variant 3 redacts serialized plan evidence`.
- The proof reuses `generatePushHarnessCases`, `runGeneratedPushHarness`, `validateGeneratedCase`, `createPushPlan`, and `applyPlan` without changing the generated harness implementation.
- It recounts the `delete-edit-conflict` / `delete-edit` target coverage across tiers 0 through 9 and compares the result with `summary.targetCoverage.localDeleteRemoteEdit`.

## Redaction and refusal proof

For every generated delete/edit target case, the test identifies the generated row that local deletes and remote edits, serializes hash-only plan evidence, and asserts the serialized evidence omits both the generated base title and the generated remote title. The same proof checks that the target row has no mutation or precondition, every unrelated mutation still has a live-remote precondition, `applyPlan` raises `PLAN_NOT_READY`, and replay remote state is byte-for-byte unchanged.

The final serialized coverage proof stores case ids, tiers, counts, row resource keys, conflict classes, change directions, and remote hashes only. It is also scanned for the generated target raw values.

## Commands

```sh
node --check test/rpp-0243-local-delete-remote-edit-v3.test.js
node --test test/rpp-0243-local-delete-remote-edit-v3.test.js
node --test --test-name-pattern='RPP-0203|RPP-0223|local deletion' test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0243-local-delete-remote-edit-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0243 generated coverage slice. It does not carry the invariant through the release verifier; later release-verifier checklist items remain separate gates.
