# RPP-0487 wp_usermeta release verifier carry-through v5 evidence

Date: 2026-05-30

## Scope

This is focused release-verifier carry-through evidence for `wp_usermeta`
plugin-driver semantics, variant 5. It adds a verifier summary for exact
`umeta_id:<id>` `wp_usermeta` mutations and carries the generated harness
supported/unsupported usermeta-driver variants into the production-shaped
release verifier evidence envelope. It does not claim a live production release
run.

## Proof surface

`test/rpp-0487-wp-usermeta-release-verifier-v5.test.js` proves:

- generated harness support evidence covers all ten supported
  `supported-plugin-usermeta` tiers as `ready` with live-remote preconditions,
  apply success, and stale replay rejection before mutation;
- generated harness fail-closed evidence covers all ten unsupported
  `unsupported-plugin-usermeta` tiers as `blocked`, with zero usermeta mutation
  for the target row and unchanged non-ready remote state;
- local `wp_usermeta` mutation evidence remains `support_only` with
  `releaseGate.status: NO-GO`, `releaseGateEvidenceScope: local-candidate`, and
  a release-gate note that production-backed evidence is still required;
- a `production-backed` scope marker without checked production verifier proof
  remains `NO-GO` and records why the production proof is still required;
- a checked production-backed proof is summarized separately with
  `releaseGate.status: GO`, without changing this lane's final release posture;
  and
- `production-shaped-release-verify.mjs` carries the summary under
  `pluginDriver.coreSemantics.wpUsermeta`, while the summary includes only
  resource ids, row identity, owner/driver labels, scope markers, hashes, and
  release-gate notes.

The focused assertions verify exact `umeta_id:<id>` semantics, user id and meta
key carry-through, generated supported/unsupported coverage, apply-time
revalidation before the first mutation when a release proof includes a usermeta
mutation, and absence of raw `meta_value` payloads or `metaValue` fields from
the release verifier summary.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0487-wp-usermeta-release-verifier-v5.test.js
node --test test/rpp-0487-wp-usermeta-release-verifier-v5.test.js
node --test test/rpp-0487-wp-usermeta-release-verifier-v5.test.js test/rpp-0467-wp-usermeta-driver-semantics-v4.test.js test/plugin-driver-usermeta-semantics.test.js test/rpp-0427-wp-usermeta-driver-semantics-v2.test.js
node --test --test-name-pattern 'RPP-0487|RPP-0467|RPP-0427|RPP-0407' test/rpp-0487-wp-usermeta-release-verifier-v5.test.js test/rpp-0467-wp-usermeta-driver-semantics-v4.test.js test/rpp-0427-wp-usermeta-driver-semantics-v2.test.js test/plugin-driver-usermeta-semantics.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0487-wp-usermeta-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0487
test reported 5 subtests ok and 0 failed. The adjacent wp_usermeta
plugin-driver slice reported 15 subtests ok and 0 failed, and the focused
pattern spanning RPP-0407/RPP-0427/RPP-0467/RPP-0487 reported 15 subtests ok and
0 failed. Checklist lint returned `"ok": true`; the scoped artifact redaction
scan returned `"ok": true` for the touched docs.

## Release posture

This lane is local focused release-verifier evidence. Local/generated and
local/support-only `wp_usermeta` evidence remains release-gate `NO-GO`;
production-backed evidence is summarized separately only when the verifier proof
explicitly supplies a checked production evidence boundary. Final release
remains `NO-GO` without live production proof.
