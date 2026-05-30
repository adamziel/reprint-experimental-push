# RPP-0465 wp_postmeta driver semantics v4 evidence

Date: 2026-05-30

## Scope

This is focused local regression evidence for `wp_postmeta` plugin-driver
semantics, variant 4. It adds planner/apply coverage only and does not claim a
live production release run.

## Proof surface

`test/rpp-0465-wp-postmeta-driver-semantics-v4.test.js` proves:

- exact `post_id:<id>:meta_key:<key>` rows, including a meta key with `:`
  characters, are accepted only with explicit `wp_postmeta` driver policy;
- the local push-intent path records `releaseGateEvidenceScope:
  local-candidate`, applies one `wp_postmeta` mutation, and keeps driver/audit
  evidence hash-only with raw `meta_value` payloads absent;
- the remote-snapshot policy path records `releaseGateEvidenceScope:
  production-backed` when the snapshot declares `evidenceScope:
  production-backed`, then applies the exact `meta_id:<id>` mutation; and
- mismatched `post_id`/`meta_key` row payload identity fails closed before apply
  with local-candidate scope while preserving the remote row.

## Focused verification observed locally

```sh
node --check test/rpp-0465-wp-postmeta-driver-semantics-v4.test.js
node --test test/rpp-0465-wp-postmeta-driver-semantics-v4.test.js
node --test test/plugin-driver-postmeta-semantics.test.js test/rpp-0425-wp-postmeta-driver-semantics.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0465-wp-postmeta-driver-semantics-v4.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The focused RPP-0465 test reported 3
subtests ok and 0 failed; the adjacent postmeta regression slice reported 10
subtests ok and 0 failed; checklist lint returned `"ok": true`; and the scoped
artifact redaction scan returned `"ok": true`.

## Release posture

This proof is local regression evidence. Only the second subtest exercises a
production-backed scope marker via explicit remote snapshot metadata; it is not
a live production run.
