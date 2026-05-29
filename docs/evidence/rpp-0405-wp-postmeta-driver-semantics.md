# RPP-0405 wp_postmeta driver semantics evidence

Date: 2026-05-29

## Scope

This is variant-1 focused plugin-driver evidence for `wp_postmeta` resources.
It does not update release progress surfaces or the completion checklist.

## Proof surface

`test/plugin-driver-postmeta-semantics.test.js` now proves:

- canonical `wp-postmeta` policy accepts an exact `post_id:<id>:meta_key:<key>`
  row and emits redacted driver evidence;
- explicit remote policy metadata with `evidenceScope: production-backed`
  carries through to `releaseGateEvidenceScope: production-backed`;
- exact `meta_id:<id>` row semantics are accepted only when the row `meta_id`
  matches the resource id, while evidence exposes row identity and not
  `meta_value`;
- the `wp-post-meta` alias remains table-bound to `wp_postmeta` and preserves
  production-backed release-gate scope; and
- unsupported row identifiers fail closed before mutation with redacted blocker
  evidence.

The planner continues to treat policy without production-backed metadata as
`local-candidate` evidence. This distinction is visible in the mutation
`pluginOwnedResource.driverEvidence.releaseGateEvidenceScope` field so the
release gate can tell local proof from production-backed proof.

## Focused verification observed locally

```sh
node --test test/plugin-driver-postmeta-semantics.test.js
node --test --test-name-pattern 'RPP-0405|wp_postmeta driver' test/plugin-driver-postmeta-semantics.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0405-wp-postmeta-driver-semantics.md
git diff --check
```

Observed result: all commands exited 0. The focused postmeta test reported
6 subtests ok, 0 failed; checklist lint returned `"ok": true`; the scoped
artifact redaction scan returned `"ok": true`.

## Release posture

This remains focused plugin-driver support evidence. The production-backed
assertion is scoped to explicit remote snapshot policy metadata in the planner
fixture; it is not a live production release proof.
