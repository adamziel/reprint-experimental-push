# RPP-0467 wp_usermeta driver semantics variant 4 evidence

Date: 2026-05-30
Lane: RPP-0467 wp_usermeta driver semantics, variant 4
Checklist item: RPP-0467 — Add focused regression coverage for wp_usermeta driver semantics, variant 4.

## Scope

This is local focused generated-harness regression coverage for plugin-owned
`wp_usermeta` rows using the `wp-usermeta` driver. It validates existing
planner/apply behavior only; it does not broaden the production driver boundary
and does not update progress surfaces.

## Proof surface

`test/rpp-0467-wp-usermeta-driver-semantics-v4.test.js` covers:

- generated harness target coverage for both `usermetaDriverSupported` and
  `usermetaDriverUnsupported` across all generated tiers;
- supported generated `wp_usermeta` variants remaining `ready` while unsupported
  generated variants remain `blocked` with zero ready unsupported cases;
- exact supported `row:["wp_usermeta","umeta_id:<id>"]` mutation shape,
  including table, row id, owner, driver, delete-support flag, live-remote
  precondition, matched-remote apply, and stale replay rejection;
- unsupported generated rows whose payload `umeta_id` differs from the resource
  id producing no mutation, raising `PLAN_NOT_READY` on apply, and preserving
  the remote hash before any mutation can stage; and
- planner audit, driver-decision, blocker, journal, and proof envelopes staying
  hash-only/redacted and omitting raw `meta_value`/`metaValue` payload fields.

The proof envelopes assert `productionBacked: false` and `releaseGate: NO-GO`.
They record resource keys, owner/driver labels, reason code metadata, SHA-256
hashes for coverage/audit/driver/blocker evidence, before/after remote hashes,
and combined proof hashes only.

## Focused verification observed locally

```sh
node --check test/rpp-0467-wp-usermeta-driver-semantics-v4.test.js
node --test test/rpp-0467-wp-usermeta-driver-semantics-v4.test.js
node --test test/plugin-driver-usermeta-semantics.test.js
node --test --test-name-pattern 'RPP-0467|RPP-0427|RPP-0407 generated harness covers supported and unsupported wp_usermeta driver variants' \
  test/rpp-0467-wp-usermeta-driver-semantics-v4.test.js \
  test/rpp-0427-wp-usermeta-driver-semantics-v2.test.js \
  test/plugin-driver-usermeta-semantics.test.js \
  test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs \
  docs/evidence/rpp-0467-wp-usermeta-driver-semantics-v4.md \
  docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0467 test
reported 3 subtests ok, 0 failed. The adjacent usermeta regression reported 5
subtests ok, 0 failed. The combined adjacent usermeta/generated-harness pattern
reported 7 subtests ok, 0 failed. Checklist lint returned `"ok": true`; the
scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This remains local generated-harness evidence only. It is not live external
production evidence, and the broader release gate remains NO-GO until the
separate release-verifier and production-backed surfaces are satisfied.
