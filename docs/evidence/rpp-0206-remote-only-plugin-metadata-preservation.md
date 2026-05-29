# RPP-0206 remote-only plugin metadata preservation evidence

Date: 2026-05-29
Lane: RPP-0206 remote-only plugin metadata preservation, variant 1
Checklist item: RPP-0206 — Implement remote-only plugin metadata preservation, variant 1.

## Invariant

A remote-only plugin metadata update must be preserved as a `keep-remote` decision while independent local mutations proceed. The planner must not emit a mutation or live remote precondition for the plugin metadata resource, and apply must leave the remote plugin metadata unchanged while writing only planned local resources.

## Evidence added

- Focused/generated planner/apply test: `RPP-0206 preserves remote-only plugin metadata while applying independent local changes`.
- The focused fixture proves the one-file/one-plugin shape exactly: one ordinary file mutation, one plugin metadata `keep-remote` decision, one live remote precondition for the file, and no plugin metadata mutation/precondition.
- The generated fixture proof reuses the deterministic `remote-only-plugin-metadata` family, asserts every generated tier 0 through 9 carries the `plugin-metadata-preserve` target shape, validates stale replay refusal evidence, and replays the planner/apply invariant for each generated case.
- `docs/scenario-matrix.md` names the RPP-0206 scenario and focused command.

## Redaction and preservation proof

The focused fixture uses raw local file and remote plugin metadata markers. The generated fixture proof checks the generated remote metadata channel marker. Both paths serialize only status, summary counts, resource keys, hashes, preconditions, decisions, conflicts, blockers, and durable mutation event metadata. Assertions prove that serialized evidence, plugin decision evidence, and durable mutation events omit those raw markers.

For focused and generated fixtures, the plugin metadata decision is asserted as hash-only `keep-remote` evidence with a remote hash, no plugin metadata precondition, no plugin metadata mutation, and no durable planned/observed mutation journal event for the plugin resource. Applying the ready plan writes intended local mutations and preserves the remote plugin metadata object.

## Commands

```sh
node --test --test-name-pattern='RPP-0206' test/push-planner.test.js
node --check test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0206-remote-only-plugin-metadata-preservation.md docs/scenario-matrix.md
git diff --check
```

Caveat: this is local Node planner/apply evidence toward the RPP-0206 slice. It does not edit checklist, progress state, release verifier, or generated artifacts; release remains gated by the integration/release evidence flow.
