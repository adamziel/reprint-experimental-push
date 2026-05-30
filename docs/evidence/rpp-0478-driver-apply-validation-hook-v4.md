# RPP-0478 driver apply validation hook v4 evidence

Date: 2026-05-30
Lane: RPP-0478 driver apply validation hook, variant 4
Checklist item: RPP-0478 — Add focused regression coverage for driver apply validation hook, variant 4.

## Scope

This is variant-4 focused plugin-driver regression evidence for the driver apply
validation hook. It adds a local production-shaped `wp-option` proof that uses
`mutateRemote: true` so the checked remote object carries one real plugin-owned
`wp_options` row mutation through `applyPlan()`.

## Proof surface

`test/rpp-0478-driver-apply-validation-hook-v4.test.js` proves:

- a local-snapshot policy entry with
  `applyValidation: { hook: 'wp-option:validate-apply', status: 'passed' }`
  records `PLUGIN_DRIVER_APPLY_VALIDATION_PASSED` on the ready mutation;
- planning emits exactly one `row:["wp_options","option_name:rpp_0478_forms_settings"]`
  mutation, one live-remote precondition, and no blockers or conflicts;
- apply reaches the `beforeMutation` driver apply-validation evidence hook once
  and reports `PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED` for owner `forms`,
  driver `wp-option`, action `put`, and the expected planned/remote hashes;
- `mutateRemote: true` mutates the checked remote object, changes the target row,
  reports one applied mutation, and writes one applied journal entry; and
- planner audit evidence, driver decision evidence, apply-validation evidence,
  apply-time driver validation evidence, the journal, and the proof envelope stay
  hash-only for the private option payload sentinels.

The adjacent `test/plugin-driver-apply-validation-hook.test.js` remains the
fail-closed regression for supported apply hooks with non-passing status and
unsupported apply hooks.

## Focused verification observed locally

```sh
node --check test/rpp-0478-driver-apply-validation-hook-v4.test.js
node --test test/rpp-0478-driver-apply-validation-hook-v4.test.js
node --test test/plugin-driver-apply-validation-hook.test.js test/plugin-driver-dry-run-validation-hook.test.js test/plugin-driver-audit-redaction.test.js test/plugin-driver-delete-support-flag.test.js test/plugin-driver-registration-api.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0478-driver-apply-validation-hook-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0478 test
reported 1 subtest ok, 0 failed. The adjacent apply-validation/plugin-driver
regression slice reported its subtests ok. Checklist lint returned `"ok": true`,
and the scoped artifact redaction scan returned `"ok": true` for the touched
docs.

## Release posture

This is local production-shaped plugin-driver evidence only. It is not live
external production evidence, does not update `progress.html`, and does not
broaden accepted plugin-owned resources beyond the existing supported
`wp-option` apply-validation hook path under test. Broader release posture
remains NO-GO until the separate production-backed release proof exists.
