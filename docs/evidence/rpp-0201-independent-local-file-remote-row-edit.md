# RPP-0201 independent local file plus remote row edit evidence

Date: 2026-05-28
Lane: RPP-0201 independent local file plus remote row edit, variant 1
Checklist item: RPP-0201 — Implement independent local file plus remote row edit, variant 1.

## Invariant

A local file mutation may be applied while an independent remote row edit is preserved. The planner must keep the remote row as hash-only `keep-remote` evidence, emit no row mutation or row precondition, and apply only the local file mutation without overwriting the remote row state.

## Evidence added

- Focused/generated planner/apply test: `RPP-0201 independent local file plus remote row edit stays hash-only across focused and generated fixtures`.
- The focused fixture proves the one-file/one-row shape exactly: one file mutation, one row `keep-remote` decision, one live remote precondition for the file, and no row mutation/precondition.
- The generated fixture proof reuses the deterministic `independent-local-and-remote` family and asserts every generated tier 0 through 9 carries the `independent-file-remote-row` target shape.

## Redaction and preservation proof

The focused fixture uses private local file and remote row values, then serializes only status, summary counts, resource keys, hashes, preconditions, decisions, conflicts, blockers, and durable apply journal events. Assertions prove that evidence omits the raw local file payload and raw remote row title.

For focused and generated fixtures, the row decision is asserted as hash-only `keep-remote` evidence with a remote hash, no row precondition, no row mutation, and no durable planned/observed mutation journal event for the row. Applying the ready plan writes the intended file value and leaves the remote row title unchanged.

## Commands

```sh
node --test --test-name-pattern='RPP-0201' test/push-planner.test.js
node --check test/push-planner.test.js
node --test --test-name-pattern='RPP-0201|RPP-0221' test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0201-independent-local-file-remote-row-edit.md
git diff --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0201 slice. It does not edit checklist, progress state, release verifier, generated harness files, or generated artifacts; release remains gated by the integration/release evidence flow.
