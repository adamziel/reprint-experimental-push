# RPP-0407 wp_usermeta driver semantics evidence

Date: 2026-05-29

## Scope

This is variant-1 focused plugin-driver evidence for `wp_usermeta` resources.
It does not update release progress surfaces or the completion checklist.

## Proof surface

`test/plugin-driver-usermeta-semantics.test.js` now proves:

- canonical `wp-usermeta` policy accepts an exact `umeta_id:<id>` row and emits
  redacted driver evidence;
- explicit remote policy metadata with `evidenceScope: production-backed`
  carries through to `releaseGateEvidenceScope: production-backed`;
- the `wp-user-meta` alias remains table-bound to `wp_usermeta` and preserves
  exact `umeta_id` row semantics;
- row values whose `umeta_id` does not match the resource id fail closed before
  mutation with redacted blocker evidence; and
- unsupported row identifiers fail closed before mutation.

`test/generated-push-harness.test.js` now requires generated harness coverage
for both `plugin-usermeta-driver-supported` and
`plugin-usermeta-driver-unsupported`, and verifies the supported variant is
ready while the unsupported variant remains blocked with redacted driver
evidence.

The planner continues to treat policy without production-backed metadata as
`local-candidate` evidence. The focused assertions keep raw usermeta
`meta_value` payloads out of driver evidence and blocker evidence.

## Focused verification observed locally

```sh
node --test test/plugin-driver-usermeta-semantics.test.js
node --test --test-name-pattern 'RPP-0407' test/generated-push-harness.test.js
node --test --test-name-pattern 'generated push harness covers 300\\+|RPP-0407' test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0407-wp-usermeta-driver-semantics.md
git diff --check
```

Observed result: all commands exited 0. The focused usermeta test reported 5
subtests ok, 0 failed. The focused generated harness test reported 1 subtest ok,
0 failed; the combined generated coverage command reported 2 subtests ok, 0
failed. Checklist lint returned `"ok": true`; the scoped artifact redaction scan
for the touched evidence doc returned `"ok": true`.

## Release posture

This remains focused plugin-driver support evidence. The production-backed
assertion is scoped to explicit remote snapshot policy metadata in the planner
fixture; it is not a live production release proof.
