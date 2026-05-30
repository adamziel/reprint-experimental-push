# RPP-0494 owner context stale metadata release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0494 owner context stale metadata refusal release verifier carry-through, variant 5
Checklist item: RPP-0494 — Carry through the release verifier for owner context stale metadata refusal, variant 5.

## Scope

This is focused release-verifier carry-through evidence for stale owner plugin
metadata refusal. It keeps the proof local/support-only and records it under
`pluginDriver.ownerContext.staleMetadata` beside the existing production-owned
and core plugin-driver verifier summaries.

The proof does not claim live external production evidence. Release posture
remains NO-GO until the broader checked production release boundary is satisfied.

## Proof surface

`scripts/playground/production-shaped-release-verify.mjs` now exports
`summarizeOwnerContextStaleMetadataReleaseVerifierEvidence()`. The summary:

- builds a plugin-owned `wp_postmeta` row mutation for owner `forms` and driver
  `wp-postmeta`;
- blocks planning when the live remote `plugin:forms` metadata changed after
  the pull base, recording `STALE_PLUGIN_METADATA_OWNER_CONTEXT` and
  `PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED`;
- verifies blocked-plan apply refusal with `PLAN_NOT_READY` and unchanged
  plugin-owned remote row and remote snapshot hashes;
- verifies a ready plan carries `plugin:forms` owner metadata context and that
  stale replay refuses with `STALE_PLUGIN_OWNER_CONTEXT` before any mutation
  hook runs; and
- emits only resource ids, owner/driver labels, summary counts, reason codes,
  and SHA-256 hashes.

`test/rpp-0494-owner-context-stale-metadata-release-verifier-v5.test.js`
asserts the release-verifier proof shape, the pre-mutation replay refusal, the
`pluginDriver.ownerContext.staleMetadata` integration point, and absence of raw
`meta_value`, `option_value`, fixture payload, owner plugin metadata, or plugin
file contents from the proof.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0494-owner-context-stale-metadata-release-verifier-v5.test.js
node --test test/rpp-0494-owner-context-stale-metadata-release-verifier-v5.test.js
node --test test/rpp-0494-owner-context-stale-metadata-release-verifier-v5.test.js test/rpp-0474-owner-context-stale-metadata-refusal-v4.test.js test/rpp-0434-owner-context-stale-metadata-refusal.test.js test/plugin-owner-context-metadata-refusal.test.js test/plugin-owner-context-file-refusal.test.js test/rpp-0473-owner-context-stale-plugin-file-refusal-v4.test.js test/rpp-0475-remote-plugin-removal-refusal-v4.test.js
node --test test/rpp-0482-driver-owner-identity-release-verifier-v5.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js test/rpp-0494-owner-context-stale-metadata-release-verifier-v5.test.js
node --test --test-name-pattern 'production-shaped release verify owns the production plugin-driver boundary proof fields|production plugin-driver boundary proof accepts one owned row and fails closed for remote or unknown data|RPP-0494' test/production-shaped-proof.test.js test/rpp-0494-owner-context-stale-metadata-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0494-owner-context-stale-metadata-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: syntax checks exited 0. The focused RPP-0494 test reported
3 subtests ok, 0 failed. The adjacent owner-context metadata/refusal slice
reported 22 tests ok, 0 failed. The adjacent v5 release-verifier slice reported
16 tests ok, 0 failed. The focused production-shaped plugin-driver verifier
slice reported 5 tests ok, 0 failed. Checklist lint and the scoped redaction
scan returned `"ok": true`; both diff whitespace checks exited 0.

## Release posture

This is local release-verifier carry-through evidence only. The emitted
`ownerContext.staleMetadata` proof is support-only, productionBacked `false`,
releaseEligible `false`, and release-gate `NO-GO`. Integration can proceed as a
plugin-driver verifier evidence improvement, but it should not move the final
release gate without live production-backed proof.
