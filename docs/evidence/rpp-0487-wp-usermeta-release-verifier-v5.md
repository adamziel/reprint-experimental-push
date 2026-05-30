# RPP-0487 wp_usermeta release verifier carry-through v5 evidence

Date: 2026-05-30

## Scope

This is focused release-verifier carry-through evidence for `wp_usermeta`
plugin-driver semantics, variant 5. It adds a verifier summary for exact
`umeta_id:<id>` `wp_usermeta` mutations so the plugin-driver release proof
records whether the row evidence is local/support-only or production-backed.
It also keeps generated supported and unsupported `wp_usermeta` variants
visible as local support evidence. It does not claim a live production release
run.

## Proof surface

`test/rpp-0487-wp-usermeta-release-verifier-v5.test.js` proves:

- local `wp_usermeta` mutation evidence remains `support_only` with
  `releaseGate.status: NO-GO`, `releaseGateEvidenceScope: local-candidate`,
  and a release-gate note that production-backed evidence is still required;
- a `production-backed` scope marker without checked production verifier proof
  remains `NO-GO` and records why the production proof is still required;
- a checked production-backed proof is summarized separately with
  `releaseGate.status: GO`, without changing this lane's final release posture;
- generated supported `wp_usermeta` cases stay `ready` and summarize as
  support-only verifier evidence, while generated unsupported cases remain
  `blocked` with no planned mutation; and
- `production-shaped-release-verify.mjs` carries the summary under
  `pluginDriver.coreSemantics.wpUsermeta`, while the summary includes only
  resource ids, row identity, hashes, owner/driver labels, scope markers, and
  release-gate notes.

The focused assertions verify exact `umeta_id:<id>` semantics, user id and meta
key carry-through, apply-time revalidation before the first mutation, and
absence of raw `meta_value` payloads or `metaValue` fields from the release
verifier summary.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs test/rpp-0487-wp-usermeta-release-verifier-v5.test.js
node --test test/rpp-0487-wp-usermeta-release-verifier-v5.test.js
node --test test/rpp-0487-wp-usermeta-release-verifier-v5.test.js test/rpp-0467-wp-usermeta-driver-semantics-v4.test.js test/plugin-driver-usermeta-semantics.test.js test/rpp-0427-wp-usermeta-driver-semantics-v2.test.js
node --test test/generated-push-harness.test.js
node --test test/production-plugin-package-scenarios.test.js
npm run test:playground:production-plugin-driver-verifier-guards
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0487-wp-usermeta-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0487
test reported 5 subtests ok and 0 failed. The adjacent wp_usermeta
plugin-driver slice reported 15 subtests ok and 0 failed. The generated push
harness reported 85 subtests ok and 0 failed on the integrated lane. The production plugin package
scenario summary tests reported 9 subtests ok and 0 failed, and the packaged
plugin driver verifier guard smoke completed all requested guard scenarios
successfully. Checklist lint returned `"ok": true`; the scoped artifact
redaction scan returned `"ok": true` for the touched docs.

## Release posture

This lane is local focused release-verifier evidence. Local/support-only
`wp_usermeta` evidence remains release-gate `NO-GO`; production-backed evidence
is summarized separately only when the verifier proof explicitly supplies a
checked production evidence boundary. Final release remains `NO-GO` without
live production proof.
