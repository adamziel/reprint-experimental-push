# RPP-0458 driver apply validation hook v3 evidence

Date: 2026-05-30
Lane: RPP-0458 driver apply validation hook, variant 3
Checklist item: RPP-0458 — Add generated coverage for driver apply validation hook, variant 3.

## Scope

This is local generated plugin-driver evidence for the apply-time driver
validation boundary. It adds deterministic generated cases for the
`fixture-forms-lab-table` driver without broadening supported production
resources.

## Proof surface

`test/generated-push-harness.test.js` now covers two generated RPP-0458 cases
from `scripts/harness/generated-push-cases.js`:

- the supported case plans exactly one `wp_reprint_push_forms_lab` row mutation,
  reaches `beforeMutation` once with `PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED`,
  uses `mutateRemote: true`, changes the checked remote row, and records one
  applied journal entry;
- the forged case starts from the same ready fixture plan, corrupts the driver
  evidence hash, and is rejected with `UNSUPPORTED_PLUGIN_OWNED_RESOURCE` plus
  `PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED` before the hook runs or the remote row
  changes.

The generated proof records only hashes and bounded metadata for mutations,
apply-validation evidence, driver evidence, journals, and refusal details. The
fixture plugin version and row payload sentinels are asserted absent from the
proof envelopes.

## Focused verification observed locally

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern 'RPP-0458' test/generated-push-harness.test.js
node --test --test-name-pattern 'RPP-0417|RPP-0456|RPP-0458' test/generated-push-harness.test.js
node --test --test-name-pattern 'RPP-0438|fixture forms lab table journal redacts raw payload values' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0458-driver-apply-validation-hook-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0458 run
reported 1 subtest ok, 0 failed; the adjacent generated harness slice reported
3 subtests ok, 0 failed; and the adjacent fixture apply-validation slice
reported 3 subtests ok, 0 failed.

## Release posture

This is local generated support evidence only. It is not external
production-backed evidence, does not update `progress.html`, and keeps the
release posture at NO-GO until the separate production-backed release proof is
available.
