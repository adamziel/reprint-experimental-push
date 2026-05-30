# RPP-0427 wp_usermeta driver semantics v2 evidence

Date: 2026-05-30

## Scope

This is variant-2 focused plugin-driver evidence for `wp_usermeta` resources.
It adds generated-harness proof without editing generated-harness source files or
progress surfaces.

## Proof surface

`test/rpp-0427-wp-usermeta-driver-semantics-v2.test.js` proves:

- generated harness target coverage includes both `usermetaDriverSupported` and
  `usermetaDriverUnsupported`;
- supported `wp_usermeta` variants appear in every generated tier and all remain
  `ready`;
- unsupported `wp_usermeta` variants appear in every generated tier and all fail
  closed as `blocked` with zero ready cases;
- a generated supported case emits a `wp-usermeta` `put` mutation with exact
  `umeta_id:<id>` row semantics, `releaseGateEvidenceScope: local-candidate`,
  and hash-only driver audit evidence; and
- a generated unsupported case produces no mutation for the owned row, preserves
  the non-ready remote snapshot, and records redacted fail-closed evidence when
  the row payload `umeta_id` differs from the resource id.

The assertions also check that generated driver evidence and blocker objects do
not expose raw `meta_value`/`metaValue` fields or generated raw usermeta payload
sentinels.

## Focused verification observed locally

```sh
node --check test/rpp-0427-wp-usermeta-driver-semantics-v2.test.js
node --test test/rpp-0427-wp-usermeta-driver-semantics-v2.test.js
node --test test/plugin-driver-usermeta-semantics.test.js
node --test --test-name-pattern 'RPP-0427|RPP-0407' \
  test/rpp-0427-wp-usermeta-driver-semantics-v2.test.js \
  test/plugin-driver-usermeta-semantics.test.js
node --test --test-name-pattern 'RPP-0427|RPP-0407 generated harness covers supported and unsupported wp_usermeta driver variants' \
  test/rpp-0427-wp-usermeta-driver-semantics-v2.test.js \
  test/generated-push-harness.test.js
node --test \
  test/plugin-driver-postmeta-semantics.test.js \
  test/plugin-driver-termmeta-semantics.test.js \
  test/plugin-driver-usermeta-semantics.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs \
  docs/evidence/rpp-0427-wp-usermeta-driver-semantics-v2.md \
  docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all completed commands exited 0. The new RPP-0427 test reported
2 subtests ok, 0 failed; the existing usermeta regression reported 5 subtests
ok, 0 failed; the combined focused usermeta pattern reported 7 subtests ok, 0
failed; the adjacent generated-harness pattern reported 3 subtests ok, 0 failed;
the adjacent plugin-driver meta semantics slice reported 16 subtests ok, 0
failed; checklist lint returned `"ok": true`; and the scoped artifact redaction
scan returned `"ok": true`.

## Release posture

This remains focused local generated-harness evidence only. It does not update
`progress.html` and does not claim live external production release readiness.
