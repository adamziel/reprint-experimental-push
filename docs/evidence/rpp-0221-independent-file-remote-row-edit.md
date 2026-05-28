# RPP-0221 independent local file plus remote row edit evidence

Date: 2026-05-28
Lane: RPP-0221 independent local file plus remote row edit, variant 2
Checklist item: RPP-0221 — Prove independent local file plus remote row edit, variant 2.

## Invariant

A local file edit and an independent remote row edit can coexist safely in the same ready plan. The planner must emit a mutation and live-remote precondition only for the local file, record the remote row as `keep-remote`, and leave the row untouched when apply runs.

## Evidence added

- Focused planner/apply test: `RPP-0221 independent local file plus remote row edit stays hash-only and unplanned-safe`.
- Generated harness test: `RPP-0221 generated harness preserves independent local files and remote rows`.
- Generated target coverage records the existing `independent-local-and-remote` family and `independent-merge` tag across all complexity tiers.
- Scenario matrix row names the behavior and commands for integrators.

## Redaction and no-unplanned-mutation proof

The focused test builds a private local file payload and a private remote row title, then serializes only hash metadata, mutation identifiers, resource keys, precondition hashes, decision classes, and durable apply journal events. The assertions prove those serialized evidence envelopes omit both private raw values.

The same test proves there is no row mutation or row precondition. Durable apply evidence records a planned and observed mutation only for the file resource. The apply result writes the local file payload while preserving the remote row title.

The generated test selects a deterministic generated independent merge case, validates the generated harness contract, checks the file mutation and row `keep-remote` decision, and applies the plan to prove the generated remote row remains unplanned and preserved.

## Commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --check test/push-planner.test.js
node --test test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0221-independent-file-remote-row-edit.md docs/scenario-matrix.md
git diff --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0221 slice. It does not edit checklist or progress state and does not change the release verdict; release remains NO-GO until integrated release evidence accepts it.
