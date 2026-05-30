# RPP-0464 wp_options driver semantics variant 4 evidence

Date: 2026-05-30
Lane: RPP-0464 wp_options driver semantics, variant 4
Checklist item: RPP-0464 — Add focused regression coverage for wp_options driver semantics, variant 4.

## Scope

This is local focused plugin-driver regression coverage for a plugin-owned
`wp_options` row using the `wp-option` driver. It validates existing
planner/apply behavior only; it does not broaden the accepted production driver
boundary and does not update progress surfaces.

## Proof surface

`test/rpp-0464-wp-options-driver-semantics-v4.test.js` covers:

- exact `row:["wp_options","option_name:forms_settings"]` mutation shape,
  including table, row id, owner, driver, delete-support flag, live-remote
  precondition, and hash-only planner/driver audit evidence;
- matched-remote apply of the plugin-owned option row while preserving plugin
  context and redacting row payloads from the recovery journal; and
- stale live-remote drift of the same plugin-owned option row after dry run,
  where apply raises `PRECONDITION_FAILED` before mutation and the remote row
  hash plus full remote hash are unchanged.

The stale-drift proof envelope records only resource keys, owner/driver labels,
reason code, SHA-256 hashes for audit evidence, mutation metadata,
precondition details, before/after row hashes, before/after remote hashes, and a
combined proof hash. It asserts raw base, local, and drifted option payloads are
absent from planner audit evidence, driver decision evidence, error details, the
journal, and the proof envelope.

## Focused verification observed locally

```sh
node --check test/rpp-0464-wp-options-driver-semantics-v4.test.js
node --test test/rpp-0464-wp-options-driver-semantics-v4.test.js
node --test test/plugin-driver-audit-redaction.test.js test/plugin-driver-delete-support-flag.test.js test/plugin-driver-dry-run-validation-hook.test.js
node --test --test-name-pattern 'RPP-0439|RPP-0468|plugin-owned option rows|plugin-owned data' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0464-wp-options-driver-semantics-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0464 test
reported 2 subtests ok, 0 failed. The adjacent plugin-driver regression slice
reported 9 subtests ok, 0 failed. The focused `push-planner` wp_options slice
reported 11 subtests ok, 0 failed. Checklist lint returned `"ok": true`; the
scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This remains local focused plugin-driver evidence only. It is not live external
production evidence, and the broader release gate remains NO-GO until the
separate release-verifier and production-backed surfaces are satisfied.
