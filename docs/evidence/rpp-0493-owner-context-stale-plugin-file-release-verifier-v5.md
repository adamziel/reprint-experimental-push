# RPP-0493 owner context stale plugin file release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0493 owner context stale plugin file refusal, variant 5
Checklist item: RPP-0493 - Carry through the release verifier for owner context stale plugin file refusal, variant 5.

## Scope

Focused plugin-driver and release-verifier carry-through evidence only. This
does not update generated-harness, executor-auth replay, recovery journal,
storage benchmark, progress page, or progress-log artifacts.

## Proof surface

`scripts/playground/production-shaped-release-verify.mjs` now exposes
`summarizeOwnerContextStalePluginFileReleaseVerifierProof()` and includes its
result under `pluginDriver.ownerContext.stalePluginFile`.

`test/rpp-0493-owner-context-stale-plugin-file-release-verifier-v5.test.js`
proves:

- the local verifier proof carries a ready `wp_postmeta` plugin-owned mutation
  for owner `rpp-0493-owner-context` through apply with owner context required;
- the ready path records hash-only owner plugin-file context where local and
  remote match while differing from base;
- the stale planner path refuses before mutation with
  `stale-plugin-owner-context` and `STALE_PLUGIN_FILE_OWNER_CONTEXT`;
- the stale replay path fails before `beforeMutation` with
  `STALE_PLUGIN_OWNER_CONTEXT` and preserves the remote hash; and
- the proof is deterministic, hash-only, and remains `NO-GO` because it is
  local release-verifier evidence rather than production-backed release proof.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0493-owner-context-stale-plugin-file-release-verifier-v5.test.js
node --test test/rpp-0493-owner-context-stale-plugin-file-release-verifier-v5.test.js
node --test test/rpp-0493-owner-context-stale-plugin-file-release-verifier-v5.test.js test/rpp-0473-owner-context-stale-plugin-file-refusal-v4.test.js test/rpp-0433-owner-context-stale-plugin-file-refusal.test.js test/plugin-owner-context-file-refusal.test.js test/plugin-owner-context-metadata-refusal.test.js test/plugin-remote-removal-refusal.test.js test/plugin-driver-audit-redaction.test.js
node --test test/rpp-0482-driver-owner-identity-release-verifier-v5.test.js test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js test/rpp-0493-owner-context-stale-plugin-file-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0493-owner-context-stale-plugin-file-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0493 test reported 3/3
subtests passing. The adjacent owner-context/refusal slice reported 21/21
tests passing, and the adjacent release-verifier slice reported 23/23 TAP tests
passing including nested RPP-0483 cases. Checklist lint returned `"ok": true`, the scoped redaction
scan returned `"ok": true`, and both diff whitespace checks passed.

## Release posture

NO-GO for final release movement from this slice alone. The proof carries the
owner-context stale plugin-file refusal through release-verifier evidence, but
production-backed release-gate evidence is still required before promotion.
