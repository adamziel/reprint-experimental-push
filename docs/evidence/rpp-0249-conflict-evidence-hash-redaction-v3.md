# RPP-0249 conflict evidence hash redaction, variant 3

Date: 2026-05-30
Lane: RPP-0249 conflict evidence hash redaction, variant 3
Checklist item: RPP-0249 — Add generated coverage for conflict evidence hash redaction, variant 3.

## Invariant

Generated conflict plans must keep conflict evidence hash-only across the
merge-invariant matrix. Conflict records may identify the resource, conflict
class, plugin owner when present, resolution policy, change states, file type
for file resources, related topology resource keys, and hashes. They must not
serialize raw file contents, row payload values, serialized option payloads, or
plugin-owned private fields.

Apply must still refuse generated conflict plans before mutation and before
journal evidence, leaving the live remote snapshot unchanged.

## Evidence added

- Focused generated proof: `RPP-0249 generated conflict evidence hash redaction variant 3 stays hash-only`.
- The test runs the generated harness matrix, filters all generated `conflict`
  plans, and covers variant-3 non-ready tags for directory descendants,
  file/row create-update-delete mixes, scalar and serialized options,
  `wp_posts`, `wp_postmeta`, and plugin-owned option conflicts.
- Each generated conflict is replayed from cloned inputs to prove deterministic
  conflict evidence. The proof scans emitted conflict objects and the serialized
  evidence envelope with the evidence redaction scanner.
- The test collects raw fixture needles from conflicted resources and related
  topology resources, then records only SHA-256 hashes of those needles in the
  proof envelope.
- Conflict apply is asserted to fail with `PLAN_NOT_READY` before durable
  journal events and without mutating the remote snapshot.

## Scenario matrix row

`docs/scenario-matrix.md` names the behavior as "Generated conflict evidence
hash redaction, variant 3" and records the focused command:

```sh
node --test --test-name-pattern=RPP-0249 test/rpp-0249-conflict-evidence-hash-redaction-v3.test.js
```

## Commands

```sh
node --check test/rpp-0249-conflict-evidence-hash-redaction-v3.test.js
node --test --test-name-pattern=RPP-0249 test/rpp-0249-conflict-evidence-hash-redaction-v3.test.js
node --test --test-name-pattern='RPP-0209|RPP-0229' test/push-planner.test.js
node --test --test-name-pattern=RPP-0237 test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0239 test/rpp-0239-redacted-raw-value-evidence-v2.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0249-conflict-evidence-hash-redaction-v3.md docs/scenario-matrix.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Caveat: this is local generated planner/apply evidence for the RPP-0249 slice.
Release remains governed by the broader integration and release evidence flow.
