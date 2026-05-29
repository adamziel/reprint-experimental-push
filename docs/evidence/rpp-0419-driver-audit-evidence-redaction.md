# RPP-0419 driver audit evidence redaction evidence

Date: 2026-05-29

## Scope

This is variant-1 focused plugin-driver evidence for driver audit evidence
redaction. It validates the existing planner/apply behavior for plugin-owned
`wp_options` rows with the `wp-option` driver and does not broaden accepted
plugin-owned resources.

## Proof surface

`test/plugin-driver-audit-redaction.test.js` now names the RPP-0419 proof and
covers:

- supported plugin-owned row planning emits hash-only
  `mutation.pluginOwnedResource.driverAuditEvidence` decision evidence and
  hash-only `mutation.pluginOwnedResource.auditEvidence` planner evidence;
- remote plugin owner-context drift blocks the driver decision with
  `PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED`, emits only hashes, and leaves the
  remote plugin-owned row untouched; and
- stale remote row drift after dry run fails apply with `PRECONDITION_FAILED`
  before mutation, preserving the drifted remote plugin-owned row while the
  local proof stores only hashes of decision audit evidence, planner audit
  evidence, and precondition details.

The focused proof asserts raw base, local, remote, and drifted option values are
absent from the audit/proof JSON and passes the reusable evidence redaction
assertion helper.

## Focused verification observed locally

```sh
node --test --test-name-pattern 'RPP-0419|driver audit' test/plugin-driver-audit-redaction.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0419-driver-audit-evidence-redaction.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The focused RPP-0419 validation reported
3 subtests ok, 0 failed; checklist lint returned `"ok": true`; the scoped
artifact redaction scan for touched docs returned `"ok": true`.

## Release posture

This is local focused plugin-driver proof, not a live external production
release claim. It does not update `progress.html` and does not publish progress.
