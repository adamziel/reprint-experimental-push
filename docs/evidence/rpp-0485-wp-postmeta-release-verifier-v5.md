# RPP-0485 wp_postmeta release verifier carry-through v5 evidence

Date: 2026-05-30

## Scope

This is focused release-verifier carry-through evidence for `wp_postmeta`
plugin-driver semantics, variant 5. It adds a verifier summary for
`wp_postmeta` core-driver mutations so the plugin-driver release proof records
whether the row evidence is local/support-only or production-backed. It does
not claim a live production release run.

## Proof surface

`test/rpp-0485-wp-postmeta-release-verifier-v5.test.js` proves:

- local `wp_postmeta` mutation evidence remains `support_only` with
  `releaseGate.status: NO-GO`, `releaseGateEvidenceScope: local-candidate`,
  and a release-gate note that production-backed evidence is still required;
- a `production-backed` scope marker without checked production verifier proof
  remains `NO-GO` and records why the production proof is still required;
- a checked production-backed proof is summarized separately with
  `releaseGate.status: GO`, without changing this lane's final release posture;
  and
- `production-shaped-release-verify.mjs` carries the summary under
  `pluginDriver.coreSemantics.wpPostmeta`, while the summary includes only
  resource ids, row identity, hashes, owner/driver labels, scope markers, and
  release-gate notes.

The focused assertions verify exact `post_id:<id>:meta_key:<key>` and
`meta_id:<id>` semantics, apply-time revalidation before the first mutation,
and absence of raw `meta_value` payloads or `metaValue` fields from the release
verifier summary.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs test/rpp-0485-wp-postmeta-release-verifier-v5.test.js
node --test test/rpp-0485-wp-postmeta-release-verifier-v5.test.js
node --test test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0465-wp-postmeta-driver-semantics-v4.test.js test/plugin-driver-postmeta-semantics.test.js test/rpp-0425-wp-postmeta-driver-semantics.test.js
node --test --test-name-pattern 'production-shaped release verify source runs the packaged plugin driver revoked credential guard in bounded mode|production-shaped release verify owns the production plugin-driver boundary proof fields|production plugin-driver boundary proof accepts one owned row and fails closed for remote or unknown data|RPP-0485' test/production-shaped-proof.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js
node --test test/production-plugin-package-scenarios.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0485-wp-postmeta-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this worktree. The focused RPP-0485
test reported 4 subtests ok and 0 failed. The adjacent wp_postmeta
plugin-driver slice reported 17 subtests ok and 0 failed. The focused
production-shaped release verifier slice reported 7 subtests ok and 0 failed,
and the production plugin package scenario summary tests reported 9 subtests ok
and 0 failed. Checklist lint returned `"ok": true`; the scoped artifact
redaction scan returned `"ok": true` for the touched docs.

## Release posture

This lane is local focused release-verifier evidence. Local/support-only
`wp_postmeta` evidence remains release-gate `NO-GO`; production-backed evidence
is summarized separately only when the verifier proof explicitly supplies a
checked production evidence boundary. Final release remains `NO-GO` without
live production proof.
