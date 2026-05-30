# RPP-0437 driver dry-run validation hook evidence

Date: 2026-05-30
Lane: RPP-0437 driver dry-run validation hook, variant 2
Checklist item: RPP-0437 — Prove driver dry-run validation hook, variant 2.

## Scope

This is local generated-harness proof for the plugin-driver dry-run validation
hook. The existing planner hook behavior was already sufficient, so this lane
adds focused proof coverage without broad planner refactors and without editing
generated harness source files.

## Proof surface

`test/rpp-0437-driver-dry-run-validation-hook.test.js` imports the generated
harness driver dry-run validation cases and validates both required variants:

- `supported-dry-run-hook-applies`: a `wp-option` plugin-owned row with
  `wp-option:validate-row` produces a ready plan, one mutation, and one applied
  mutation; and
- `unsupported-dry-run-hook-blocked`: an unsupported dry-run hook produces a
  blocked plan, zero mutations, and preserved remote data after apply refusal.

The proof records only local-generated metadata, status/outcome counts, and
SHA-256 proof hashes. It also asserts the generated raw plugin/version/option
fixture tokens are absent from the proof envelope.

`test/plugin-driver-dry-run-validation-hook.test.js` remains the adjacent
planner regression proving the concrete hook behavior: supported hooks record
`PLUGIN_DRIVER_DRY_RUN_VALIDATION_PASSED`, unsupported hooks fail closed with
`PLUGIN_DRIVER_DRY_RUN_VALIDATION_UNSUPPORTED`, and supported hooks with a
non-passing status fail closed with `PLUGIN_DRIVER_DRY_RUN_VALIDATION_FAILED`.

## Focused verification observed locally

```sh
node --check test/rpp-0437-driver-dry-run-validation-hook.test.js
node --test --test-name-pattern 'RPP-0437|driver dry-run validation' test/rpp-0437-driver-dry-run-validation-hook.test.js test/plugin-driver-dry-run-validation-hook.test.js
node --test test/plugin-driver-dry-run-validation-hook.test.js
node --test test/plugin-driver-audit-redaction.test.js test/plugin-driver-delete-support-flag.test.js test/plugin-remote-removal-refusal.test.js test/plugin-uninstall-delete-refusal.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0437-driver-dry-run-validation-hook.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0437
subtest reported the supported and unsupported generated-harness variants; the
adjacent plugin-driver dry-run validation regression reported three subtests ok,
and the adjacent redaction/delete/refusal regression slice reported 14 subtests
ok. Checklist lint returned `"ok": true`; the scoped artifact redaction scan returned
`"ok": true` for the touched docs.

## Release posture

This evidence is local generated-harness proof only. It is not production-backed
release evidence, does not update progress surfaces, and does not broaden the
set of accepted plugin-owned driver hooks.
