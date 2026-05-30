# RPP-0425 wp_postmeta driver semantics evidence

Date: 2026-05-30

## Scope

This is variant-2 focused plugin-driver evidence for `wp_postmeta` resources.
It adds planner-level proof only and does not update progress surfaces.

## Proof surface

`test/rpp-0425-wp-postmeta-driver-semantics.test.js` proves:

- exact `post_id:<id>:meta_key:<key>` rows are accepted for `wp-post-meta`
  only when the policy is table-bound to `wp_postmeta`;
- default push-intent policy emits `releaseGateEvidenceScope: local-candidate`,
  so release review can distinguish local proof from production-backed proof;
- exact `meta_id:<id>` rows can carry `releaseGateEvidenceScope:
  production-backed` when the explicit remote snapshot policy metadata declares
  `evidenceScope: production-backed`;
- `meta_id:<id>` rows fail closed before mutation when the row payload identity
  does not match the resource id; and
- `wp-postmeta` policies with an explicit non-`wp_postmeta` table fail closed
  before mutation.

The focused assertions also check that postmeta driver evidence and refusal
objects do not include raw `meta_value`/`metaValue` payload fields or fixture
payload strings.

## Focused verification observed locally

```sh
node --test test/rpp-0425-wp-postmeta-driver-semantics.test.js
node --test test/plugin-driver-postmeta-semantics.test.js
node --test --test-name-pattern 'RPP-0425|wp_postmeta driver' test/rpp-0425-wp-postmeta-driver-semantics.test.js test/plugin-driver-postmeta-semantics.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0425-wp-postmeta-driver-semantics.md
git diff --check
```

Observed result: all commands exited 0. The focused RPP-0425 test reported 4
subtests ok, 0 failed; the existing postmeta regression test reported 6 subtests
ok, 0 failed; the combined focused pattern reported 9 subtests ok, 0 failed;
checklist lint returned `"ok": true`; the scoped artifact redaction scan returned
`"ok": true`.

## Release posture

This remains focused plugin-driver support evidence. The production-backed
assertion is limited to explicit remote snapshot policy metadata in the planner
fixture; it is not a live production release proof.
