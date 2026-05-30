# RPP-0426 wp_termmeta driver semantics evidence

Date: 2026-05-30

## Scope

This is variant-2 focused plugin-driver evidence for `wp_termmeta` resources.
It adds planner-level proof only and does not update progress surfaces.

## Proof surface

`test/rpp-0426-wp-termmeta-driver-semantics.test.js` proves:

- exact `meta_id:<id>` rows are accepted for `wp-term-meta` when the policy is
  table-bound to `wp_termmeta`;
- default push-intent policy emits `releaseGateEvidenceScope: local-candidate`,
  so release review can distinguish local proof from production-backed proof;
- exact `meta_id:<id>` rows can carry `releaseGateEvidenceScope:
  production-backed` when explicit remote snapshot policy metadata declares
  `evidenceScope: production-backed`;
- rows fail closed before mutation when the row payload `meta_id` does not match
  the resource id;
- non-`meta_id:<id>` `wp_termmeta` row identifiers fail closed before mutation;
  and
- `wp-termmeta` policies with an explicit non-`wp_termmeta` table fail closed
  before mutation.

The focused assertions also check that termmeta driver evidence and refusal
objects do not include raw `meta_value`/`metaValue` payload fields or fixture
payload strings.

## Focused verification observed locally

```sh
node --test test/rpp-0426-wp-termmeta-driver-semantics.test.js
node --test test/plugin-driver-termmeta-semantics.test.js
node --test --test-name-pattern 'RPP-0426|wp_termmeta driver' test/rpp-0426-wp-termmeta-driver-semantics.test.js test/plugin-driver-termmeta-semantics.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0426-wp-termmeta-driver-semantics.md
git diff --check
```

Observed result: all commands exited 0. The focused RPP-0426 test reported 5
subtests ok, 0 failed; the existing termmeta regression test reported 5 subtests
ok, 0 failed; the combined focused pattern reported 10 subtests ok, 0 failed;
checklist lint returned `"ok": true`; the scoped artifact redaction scan returned
`"ok": true`.

## Release posture

This remains focused plugin-driver support evidence. The production-backed
assertion is limited to explicit remote snapshot policy metadata in the planner
fixture; it is not a live production release proof.
