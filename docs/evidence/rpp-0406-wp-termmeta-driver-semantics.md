# RPP-0406 wp_termmeta driver semantics evidence

Date: 2026-05-29

## Scope

This is variant-1 focused plugin-driver evidence for `wp_termmeta` resources.
It does not update release progress surfaces or the completion checklist.

## Proof surface

`test/plugin-driver-termmeta-semantics.test.js` now proves:

- canonical `wp-termmeta` policy accepts an exact `meta_id:<id>` row and emits
  redacted driver evidence;
- explicit remote policy metadata with `evidenceScope: production-backed`
  carries through to `releaseGateEvidenceScope: production-backed`;
- the `wp-term-meta` alias remains table-bound to `wp_termmeta` and preserves
  exact `meta_id` row semantics;
- row values whose `meta_id` does not match the resource id fail closed before
  mutation with redacted blocker evidence; and
- unsupported row identifiers fail closed before mutation.

The planner continues to treat policy without production-backed metadata as
`local-candidate` evidence. The focused assertions keep raw termmeta
`meta_value` payloads out of driver evidence and blocker evidence.

## Focused verification observed locally

```sh
node --test test/plugin-driver-termmeta-semantics.test.js
node --test --test-name-pattern 'RPP-0406|wp_termmeta driver' test/plugin-driver-termmeta-semantics.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0406-wp-termmeta-driver-semantics.md
git diff --check
```

Observed result: all commands exited 0. The focused termmeta test reported 5
subtests ok, 0 failed; checklist lint returned `"ok": true`; the scoped
artifact redaction scan returned `"ok": true`.

## Release posture

This remains focused plugin-driver support evidence. The production-backed
assertion is scoped to explicit remote snapshot policy metadata in the planner
fixture; it is not a live production release proof.
