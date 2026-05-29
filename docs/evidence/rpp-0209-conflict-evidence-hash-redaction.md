# RPP-0209 conflict evidence hash redaction

Date: 2026-05-29
Lane: RPP-0209 conflict evidence hash redaction, variant 1
Checklist item: RPP-0209 — Implement conflict evidence hash redaction, variant 1.

## Invariant

Direct conflicts must expose enough operator evidence to identify the refused
resource without serializing private site values. File, row, and plugin-owned
data conflicts should carry only resource keys, class/policy metadata,
change-state labels, hashes, and file type for file resources.

Apply must still refuse conflict plans before mutation, before durable journal
events, and without changing the remote snapshot.

## Evidence added

- Focused planner/apply test: `RPP-0209 serializes conflict evidence as hash-only redacted metadata`.
- The focused test covers direct `file-conflict`, `row-conflict`, and
  `plugin-data-conflict` fixtures with private base/local/remote sentinels.
- Each conflict is replayed with cloned inputs to prove deterministic hash-only
  evidence, and the serialized evidence envelope is scanned for the private
  sentinel values.
- The test also runs the shared evidence redaction scanner over the emitted
  conflict objects, proving the conflict records are already hash-only and do
  not need raw-value redaction.

## Scenario matrix row

`docs/scenario-matrix.md` names the behavior as "Conflict evidence hash
redaction" and records the focused command:

```sh
node --test --test-name-pattern=RPP-0209 test/push-planner.test.js
```

## Commands

```sh
node --check test/push-planner.test.js
node --test --test-name-pattern=RPP-0209 test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0209-conflict-evidence-hash-redaction.md docs/scenario-matrix.md docs/reprint-push-completion-checklist.md
git diff --check
```

Caveat: this is local Node planner/apply evidence for the RPP-0209 slice.
Release remains governed by the broader integration and release evidence flow.
