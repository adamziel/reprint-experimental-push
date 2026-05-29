# RPP-0417 driver dry-run validation hook evidence

Date: 2026-05-29

## Scope

This is variant-1 focused plugin-driver evidence for the driver dry-run
validation hook. It covers a supported `wp-option` validation hook that allows a
plugin-owned row mutation and an unsupported hook that fails closed before any
mutation is planned.

## Proof surface

`test/plugin-driver-dry-run-validation-hook.test.js` proves the planner hook path:

- `dryRunValidation: { hook: 'wp-option:validate-row', status: 'passed' }`
  records `PLUGIN_DRIVER_DRY_RUN_VALIDATION_PASSED` on the ready mutation;
- an unsupported dry-run hook records
  `PLUGIN_DRIVER_DRY_RUN_VALIDATION_UNSUPPORTED` on a blocker and produces no
  mutation for the plugin-owned row;
- a supported hook with non-passing status records
  `PLUGIN_DRIVER_DRY_RUN_VALIDATION_FAILED` and fails closed before mutation;
- blocked plans are refused by apply; and
- blocker/error evidence remains hash-only and omits raw option payload values.

`test/generated-push-harness.test.js` now includes `RPP-0417` generated harness
coverage via `generateDriverDryRunValidationHookCases()` and
`validateDriverDryRunValidationHookCase()`. The generated cases cover:

- `supported-dry-run-hook-applies`: ready plan, one plugin-owned `wp_options`
  mutation, supported hook evidence, and one applied mutation; and
- `unsupported-dry-run-hook-blocked`: blocked plan, zero mutations, stable
  unsupported-hook evidence, and unchanged remote data after apply refusal.

The generated proof records local-generated, non-production-backed evidence and
checks that private plugin/version/option tokens do not appear in emitted proof,
blocker, mutation, or error evidence.

## Focused verification observed locally

```sh
npm test -- --test-name-pattern='RPP-0417|driver dry-run validation' test/generated-push-harness.test.js test/plugin-driver-dry-run-validation-hook.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0417-driver-dry-run-validation-hook.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The focused RPP-0417 validation reported
3 subtests ok, 0 failed, including the generated-harness RPP-0417
subtest; checklist lint returned `"ok": true`; the scoped artifact redaction
scan returned `"ok": true`.

## Release posture

This remains focused local/generated plugin-driver evidence only. It does not
update `progress.html` and does not claim live external production release
readiness.
