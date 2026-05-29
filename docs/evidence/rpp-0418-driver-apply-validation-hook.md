# RPP-0418 driver apply validation hook evidence

Date: 2026-05-29

## Scope

This is variant-1 focused plugin-driver evidence for the driver apply validation
hook. It covers a supported `wp-option` apply validation hook that carries one
real plugin-owned `wp_options` row mutation through apply.

## Proof surface

`test/plugin-driver-apply-validation-hook.test.js` now names the accepted path as
`RPP-0418` and proves:

- `applyValidation: { hook: 'wp-option:validate-apply', status: 'passed' }`
  records `PLUGIN_DRIVER_APPLY_VALIDATION_PASSED` on the ready mutation;
- `applyPlan()` reaches the `beforeMutation` driver apply validation hook with
  `driverApplyValidation` evidence marked
  `PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED`;
- exactly one `wp-option` plugin-owned row mutation is applied; and
- the local proof object stays hash-only and omits the private local and remote
  option payload values.

The same focused test file keeps the fail-closed coverage for supported hooks
with non-passing status and unsupported apply hooks. Both refusal paths preserve
the remote row before mutation and emit redacted refusal evidence.

## Focused verification observed locally

```sh
node --test --test-name-pattern 'RPP-0418|driver apply validation' test/plugin-driver-apply-validation-hook.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0418-driver-apply-validation-hook.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The focused RPP-0418 validation reported
3 subtests ok, 0 failed; checklist lint returned `"ok": true`; the scoped
artifact redaction scan for touched docs/evidence returned `"ok": true`.

## Release posture

This remains local production-shaped plugin-driver proof, not a live external
production release claim. It does not update `progress.html` and does not
broaden accepted plugin-owned resources beyond the existing supported
`wp-option` driver path.
