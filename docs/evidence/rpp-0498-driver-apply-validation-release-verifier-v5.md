# RPP-0498 driver apply validation hook release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0498 driver apply validation hook release-verifier carry-through, variant 5
Checklist item: RPP-0498 — Carry through the release verifier for driver apply validation hook, variant 5.

## Scope

This adds local production-shaped release-verifier carry-through for the
plugin-driver apply-validation hook. The verifier now emits a hash-only
`driverApplyValidationHook` proof beside the existing plugin-driver summaries.

The proof is deliberately local/support-only. It does not broaden the checked
live production boundary and final release posture remains NO-GO without
separate production-backed release evidence.

## Proof surface

`test/rpp-0498-driver-apply-validation-release-verifier-v5.test.js` verifies
that the release verifier:

- builds a ready one-row `wp_options` plugin-owned mutation for owner `forms`
  and driver `wp-option`;
- carries a local-snapshot policy entry with
  `applyValidation: { hook: 'wp-option:validate-apply', status: 'passed' }`;
- records planner-side `PLUGIN_DRIVER_APPLY_VALIDATION_PASSED` evidence;
- runs `applyPlan()` with `mutateRemote: true`, reaches the before-mutation
  driver apply-validation hook once, and records
  `PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED`;
- changes the checked remote object and target row, applies exactly one
  mutation, and writes one applied journal entry; and
- keeps the summary hash-only, with no raw option values or private fixture
  payloads in the release-verifier evidence.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0498-driver-apply-validation-release-verifier-v5.test.js
node --test test/rpp-0498-driver-apply-validation-release-verifier-v5.test.js
node --test test/rpp-0478-driver-apply-validation-hook-v4.test.js test/plugin-driver-apply-validation-hook.test.js
node --test test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0498-driver-apply-validation-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0498
test reported 2 subtests ok, 0 failed. The adjacent apply-validation slice and
nearby release-verifier plugin-driver slices exited 0. Checklist lint returned
`"ok": true`; the scoped artifact redaction scan returned `"ok": true` for
the touched docs.

## Release posture

This is local production-shaped plugin-driver evidence only. The emitted
`driverApplyValidationHook` proof is support-only and productionBacked `false`;
release remains NO-GO until the separate live production boundary is satisfied.
