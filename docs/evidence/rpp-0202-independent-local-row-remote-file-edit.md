# RPP-0202 independent local row plus remote file edit evidence

Date: 2026-05-29
Lane: RPP-0202 independent local row plus remote file edit, variant 1
Checklist item: RPP-0202 — Implement independent local row plus remote file edit, variant 1.

## Invariant

A local row mutation may be applied while an independent remote file edit is preserved. The planner must keep the remote file as hash-only `keep-remote` evidence, emit no file mutation or file precondition, and apply only the local row mutation without overwriting remote file state.

## Evidence added

- Focused planner/apply test: `RPP-0202 independent local row plus remote file edit rejects forged and stale mutation attempts`.
- The focused fixture proves the one-row/one-file shape exactly: one row mutation, one file `keep-remote` decision, one live remote precondition for the row, and no file mutation/precondition.
- Apply envelope validation now rejects a forged ready-plan mutation that targets a resource already recorded as a keep-remote decision, preventing an unplanned remote file overwrite before durable mutation evidence is written.

## Redaction, forged replay, and stale replay proof

The fixture uses private local row, private remote file, and private forged file values, then records only status, summary counts, resource keys, hashes, decisions, preconditions, and durable apply journal event types. Assertions prove those evidence envelopes and refusal details omit all private raw values.

The success path records planned and observed durable mutation events only for the row resource. Applying the ready plan writes the local row title and preserves the remote file payload.

The forged path appends a file mutation and live precondition to the ready plan while the file remains a `keep-remote` decision. The executor rejects it with `PLAN_INVARIANT_VIOLATION` and `MUTATION_DECISION_RESOURCE_OVERLAP` before mutation or durable journal writes; the remote file stays unchanged.

The stale path changes the remote row after planning. The executor rejects with `PRECONDITION_FAILED`, leaves the remote snapshot byte-for-byte unchanged, and preserves the independent remote file edit.

## Commands

```sh
node --check src/apply.js
node --check test/push-planner.test.js
node --test --test-name-pattern='RPP-0202|RPP-0222' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0202-independent-local-row-remote-file-edit.md
git diff --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0202 slice. It does not edit checklist, progress state, release verifier, generated harness files, or generated artifacts; release remains gated by the integration/release evidence flow.
