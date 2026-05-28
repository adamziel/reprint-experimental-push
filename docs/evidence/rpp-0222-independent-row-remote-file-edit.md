# RPP-0222 independent local row plus remote file edit evidence

Date: 2026-05-28
Lane: RPP-0222 independent local row plus remote file edit, variant 2
Checklist item: RPP-0222 — Prove independent local row plus remote file edit, variant 2.

## Invariant

A local row edit and an independent remote file edit can coexist safely in the same ready plan. The planner must emit a mutation and live-remote precondition only for the local row, record the remote file as `keep-remote`, and leave the file untouched when apply runs.

## Evidence added

- Focused planner/apply test: `RPP-0222 independent local row plus remote file edit stays hash-only and unplanned-safe`.
- Generated harness test: `RPP-0222 generated harness preserves independent local rows and remote files`.
- Generated target coverage records the new `independent-local-row-remote-file` family and `independent-row-remote-file` tag across all complexity tiers.
- Scenario matrix row names the behavior, stale replay guard, and proof commands for integrators.

## Redaction, stale replay, and no-unplanned-mutation proof

The focused test builds a private local row title and a private remote file payload, then serializes only hash metadata, mutation identifiers, resource keys, precondition hashes, decision classes, and durable apply journal events. Assertions prove those serialized evidence envelopes omit both private raw values.

The same test proves there is no file mutation or file precondition. Durable apply evidence records a planned and observed mutation only for the row resource. The apply result writes the local row while preserving the remote file payload. A stale replay where the row changed after planning rejects with `PRECONDITION_FAILED` before mutation and reports only hash evidence.

The generated test selects a deterministic generated independent row/file case, validates the generated harness contract, checks the row mutation and file `keep-remote` decision, and applies the plan to prove the generated remote file remains unplanned and preserved.

## Commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --check test/push-planner.test.js
node --test test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0222-independent-row-remote-file-edit.md docs/scenario-matrix.md
git diff --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0222 slice. It does not edit checklist or progress state and does not change the release verdict; release remains NO-GO until integrated release evidence accepts it.
