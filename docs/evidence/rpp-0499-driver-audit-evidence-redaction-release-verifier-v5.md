# RPP-0499 driver audit evidence redaction release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0499 driver audit evidence redaction release verifier carry-through, variant 5
Checklist item: RPP-0499 — Carry through the release verifier for driver audit evidence redaction, variant 5.

## Scope

This adds release-verifier carry-through for plugin-driver audit evidence
redaction. The release verifier now emits an `auditEvidenceRedaction` proof
beside the production-owned and driver-semantics plugin-driver summaries.

The proof is local release-verifier support evidence only. It does not broaden
the live production release boundary, and the final release posture remains
NO-GO until a separate checked production source satisfies the broader gate.

## Proof surface

`test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js`
verifies that the release verifier:

- builds the plugin-owned `wp_options` row mutation for owner `forms` and
  driver `wp-option`;
- records hash-only planner audit evidence and driver decision evidence on the
  accepted path;
- blocks owner-context drift before mutation with
  `PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED`;
- simulates stale remote row drift before apply and observes
  `PRECONDITION_FAILED` before the mutation hook runs;
- proves both the drifted option-row hash and the full remote hash are
  unchanged after refusal; and
- keeps raw option payloads, plugin-file drift text, `option_value`, and
  `__pluginOwner` fields out of the release-verifier proof envelope.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js
node --test test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js
node --test test/plugin-driver-audit-redaction.test.js test/rpp-0479-driver-audit-evidence-redaction-v4.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js
node --test --test-name-pattern 'production plugin-driver boundary proof accepts|RPP-0484|RPP-0499' test/production-shaped-proof.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js
node --test test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0499 test reported 2
subtests ok, 0 failed. Adjacent audit-redaction and release-verifier slices
also exited 0. Checklist lint returned `"ok": true`; the scoped artifact
redaction scan returned `"ok": true` for the touched docs.

## Release posture

NO-GO for final release movement from this slice alone. The emitted
`auditEvidenceRedaction` proof is hash-only and explicitly support-only; live
production-backed release proof is still required for promotion.
