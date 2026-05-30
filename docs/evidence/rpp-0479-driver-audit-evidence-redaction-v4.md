# RPP-0479 driver audit evidence redaction v4 evidence

Date: 2026-05-30
Lane: RPP-0479 driver audit evidence redaction, variant 4
Checklist item: RPP-0479 — Add focused regression coverage for driver audit evidence redaction, variant 4.

## Scope

This is local focused plugin-driver regression coverage for audit evidence
redaction on a plugin-owned `wp_options` row using the `wp-option` driver. It
validates existing planner/apply behavior only; it does not broaden accepted
plugin-owned resources and does not claim live external production proof.

## Proof surface

`test/rpp-0479-driver-audit-evidence-redaction-v4.test.js` covers two remote
drift paths:

- remote owner-context drift of `file:wp-content/plugins/forms/forms.php`, where
  the planner blocks the plugin-owned option mutation with
  `stale-plugin-owner-context`, emits `PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED`
  decision evidence, and keeps the remote plugin-owned row hash unchanged; and
- stale live-remote row drift after dry run, where `applyPlan()` raises
  `PRECONDITION_FAILED` before the mutation hook runs and preserves the drifted
  plugin-owned option row plus the full remote hash.

The proof envelopes retain only resource keys, owner/driver labels, reason
codes, SHA-256 hashes for audit evidence, blocker/precondition details,
before/after row hashes, before/after remote hashes, and a combined proof hash.
The tests assert that raw base, local, owner-context drift, and stale remote row
payloads are absent from planner audit evidence, driver decision evidence,
blocker evidence, error details, and proof envelopes, and they also run the
shared evidence redaction assertion helper against each evidence surface.

## Focused verification observed locally

```sh
node --check test/rpp-0479-driver-audit-evidence-redaction-v4.test.js
node --test test/rpp-0479-driver-audit-evidence-redaction-v4.test.js
node --test test/plugin-driver-audit-redaction.test.js test/rpp-0464-wp-options-driver-semantics-v4.test.js test/rpp-0462-driver-owner-identity-binding-v4.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0479-driver-audit-evidence-redaction-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0479 test
reported 2 subtests ok and zero failures; checklist lint returned `"ok": true`;
the scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This remains local focused plugin-driver regression evidence only. It is not
live external production evidence, and the broader release gate remains NO-GO
until the separate release-verifier and production-backed surfaces are
satisfied.
