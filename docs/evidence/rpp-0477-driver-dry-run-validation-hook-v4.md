# RPP-0477 driver dry-run validation hook variant 4 evidence

Date: 2026-05-30
Lane: RPP-0477 driver dry-run validation hook, variant 4
Checklist item: RPP-0477 — Add focused regression coverage for driver dry-run validation hook, variant 4.

## Scope

This is focused local-generated regression evidence for the plugin-driver
dry-run validation hook. It validates existing planner/apply behavior and the
shared generated harness case set; it does not edit production source, broaden
accepted dry-run hooks, or update progress surfaces.

## Proof surface

`test/rpp-0477-driver-dry-run-validation-hook-v4.test.js` imports
`generateDriverDryRunValidationHookCases()` and proves the generated harness
covers both required variants:

- `supported-dry-run-hook-applies`: the `wp-option:validate-row` hook records
  `PLUGIN_DRIVER_DRY_RUN_VALIDATION_PASSED`, produces one ready `wp_options`
  plugin-owned mutation, carries hash-only change evidence, and applies one
  mutation to a matching remote snapshot.
- `unsupported-dry-run-hook-blocked`: the unsupported
  `wp-option:unsupported-dry-run` hook records
  `PLUGIN_DRIVER_DRY_RUN_VALIDATION_UNSUPPORTED`, produces a blocked plan with
  zero mutations and zero preconditions, refuses apply with `PLAN_NOT_READY`,
  and leaves the remote snapshot unchanged.

The focused proof envelope records only resource keys, owner/driver labels,
hook names, reason codes, mutation/blocker hashes, result hash, and local
NO-GO release posture. Generated private fixture markers are asserted absent
from mutation evidence, blocker evidence, apply error details, journals, and
the proof envelope.

## Focused verification observed locally

```sh
node --check test/rpp-0477-driver-dry-run-validation-hook-v4.test.js
node --test test/rpp-0477-driver-dry-run-validation-hook-v4.test.js
node --test test/plugin-driver-dry-run-validation-hook.test.js test/rpp-0437-driver-dry-run-validation-hook.test.js test/plugin-driver-apply-validation-hook.test.js test/plugin-driver-delete-support-flag.test.js test/plugin-driver-audit-redaction.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0477-driver-dry-run-validation-hook-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0477 test
reported one subtest ok with one supported generated variant and one
unsupported generated variant. The adjacent dry-run validation/plugin-driver
regression slice reported 13 subtests ok. Checklist lint returned `"ok":
true`; the scoped artifact redaction scan returned `"ok": true` for the
touched docs.

## Release posture

This remains local-generated regression evidence only. It is not live
production evidence, and the broader release gate remains NO-GO until separate
production-backed release-verifier proof exists.
