# RPP-0497 driver dry-run validation hook release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0497 driver dry-run validation hook release verifier carry-through, variant 5
Checklist item: RPP-0497 — Carry through the release verifier for driver dry-run validation hook, variant 5.

## Scope

This is focused local release-verifier carry-through evidence for the plugin
driver dry-run validation hook. The verifier now emits a hash-only
`pluginDriver.dryRunValidationHook` proof beside the existing plugin-driver
release-verifier evidence.

No production source, generated harness, executor-auth replay, recovery journal,
storage benchmark, progress surface, or supervisor report was edited.

## Proof surface

`test/rpp-0497-driver-dry-run-validation-hook-release-verifier-v5.test.js`
proves:

- `supported-dry-run-hook-applies` records
  `PLUGIN_DRIVER_DRY_RUN_VALIDATION_PASSED`, creates one ready `wp_options`
  plugin-owned mutation, carries the exact `wp-option:validate-row` hook, and
  applies one mutation in local verifier evidence;
- `unsupported-dry-run-hook-blocked` records
  `PLUGIN_DRIVER_DRY_RUN_VALIDATION_UNSUPPORTED`, creates a blocked plan with
  zero mutations and zero preconditions, refuses apply with `PLAN_NOT_READY`,
  and preserves the remote hash before any mutation;
- the release-verifier proof records one supported and one unsupported variant,
  a fail-closed unsupported count of one, stable outcome hashes, and a local
  `NO-GO` release gate posture; and
- `production-shaped-release-verify.mjs` carries the proof under
  `pluginDriver.dryRunValidationHook`.

The proof includes only resource identifiers, owner/driver labels, hook names,
reason codes, counts, and hashes. It asserts that raw option payload markers and
`option_value` fields are absent from the verifier evidence.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0497-driver-dry-run-validation-hook-release-verifier-v5.test.js
node --test test/rpp-0497-driver-dry-run-validation-hook-release-verifier-v5.test.js
node --test test/plugin-driver-dry-run-validation-hook.test.js test/rpp-0477-driver-dry-run-validation-hook-v4.test.js
node --test --test-name-pattern 'RPP-0497|RPP-0484|RPP-0485|RPP-0486|production plugin-driver boundary proof accepts one owned row and fails closed for remote or unknown data' test/rpp-0497-driver-dry-run-validation-hook-release-verifier-v5.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js test/production-shaped-proof.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0497-driver-dry-run-validation-hook-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0497
test reported 4 subtests ok and 0 failed. The adjacent dry-run validation slice
reported 4 subtests ok and 0 failed. The combined nearby release-verifier slice
reported 15 subtests ok and 0 failed. Checklist lint returned `"ok": true`;
the scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This remains local release-verifier/plugin-driver evidence. It is not live
production proof and remains release-gate `NO-GO` until separate
production-backed verifier evidence is captured and accepted.
