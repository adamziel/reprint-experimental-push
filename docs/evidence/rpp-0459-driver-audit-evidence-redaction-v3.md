# RPP-0459 driver audit evidence redaction v3 evidence

Date: 2026-05-31
Lane: RPP-0459 driver audit evidence redaction, variant 3
Checklist item: RPP-0459 - Add generated coverage for driver audit evidence redaction, variant 3.

## Scope

This is local plugin-driver support evidence only. It validates hash-only audit
evidence for a plugin-owned `wp_options` row using the `wp-option` driver, and
it does not broaden accepted plugin-owned resources or claim production-backed
release proof.

## Proof surface

`test/rpp-0459-driver-audit-evidence-redaction-v3.test.js` covers two remote
drift paths:

- remote owner-context drift of `file:wp-content/plugins/forms/forms.php`
  blocks the plugin-owned option mutation with `stale-plugin-owner-context`,
  emits `PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED` driver audit evidence, refuses
  apply before mutation, and preserves the remote plugin-owned row plus the
  full remote snapshot hash; and
- stale live-remote row drift after a ready dry-run plan raises
  `PRECONDITION_FAILED` before the mutation hook runs, while preserving the
  drifted plugin-owned option row and the full remote snapshot hash.

The proof envelopes keep resource keys, owner and driver labels, reason codes,
decision states, SHA-256 hashes for planner audit evidence, driver decision
evidence, blocker/precondition details, before/after row hashes, before/after
remote hashes, and a combined proof hash. The test asserts raw option payloads,
plugin-file drift text, `option_value`, and `__pluginOwner` are absent from the
audited surfaces, and it runs the shared evidence redaction assertion helper
against the same proof surfaces.

## Focused verification observed locally

```sh
node --check test/rpp-0459-driver-audit-evidence-redaction-v3.test.js
node --test --test-name-pattern RPP-0459 test/rpp-0459-driver-audit-evidence-redaction-v3.test.js
node --test --test-name-pattern RPP-0479 test/rpp-0479-driver-audit-evidence-redaction-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0459-driver-audit-evidence-redaction-v3.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0459 test reported 2
subtests ok and zero failures. The adjacent RPP-0479 redaction test reported 2
subtests ok and zero failures. The scoped artifact redaction scan returned
`"ok": true`, and both diff whitespace checks exited 0.

## Release posture

NO-GO for release promotion from this slice alone. This proof is local
plugin-driver support evidence and does not replace production-backed release
gate evidence.
