# RPP-0287 local plugin data stale owner context release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0287 local plugin data with stale owner context release verifier carry-through, variant 5
Checklist item: RPP-0287 — Carry through the release verifier for local plugin data with stale owner context, variant 5.

## Scope

This adds release-verifier carry-through for the local plugin-owned data stale
owner-context invariant. The production-shaped verifier now emits a
support-only, hash-only `mergeInvariants.localPluginDataStaleOwnerContext`
proof beside the existing plugin-driver summaries.

The proof does not broaden the live production release boundary. It remains
NO-GO for final release movement without separate production-backed evidence.

## Proof surface

`test/rpp-0287-local-plugin-data-stale-owner-context-release-verifier-v5.test.js`
verifies that the release verifier:

- builds a ready one-row local plugin-owned `wp_options` mutation for owner
  `forms` and driver `wp-option`;
- binds the mutation to owner context for the `forms` plugin file and plugin
  metadata plus a live-remote precondition for the target option row;
- demonstrates the valid path applies exactly one mutation;
- simulates a stale live owner plugin file and observes
  `STALE_PLUGIN_OWNER_CONTEXT` before the mutation hook runs;
- forges the ready plan by removing owner-context evidence and by replacing the
  owner-context hash, then observes `STALE_PLUGIN_OWNER_CONTEXT` before any
  mutation for both attacks;
- proves the plugin-owned row hash and whole remote hash are unchanged after
  every rejected stale or forged attempt; and
- keeps raw option payloads, raw plugin-file fixture text, `option_value`, and
  `__pluginOwner` fields out of the release-verifier proof envelope.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0287-local-plugin-data-stale-owner-context-release-verifier-v5.test.js
node --test test/rpp-0287-local-plugin-data-stale-owner-context-release-verifier-v5.test.js
node --test test/rpp-0247-local-plugin-data-stale-owner-context-v3.test.js test/rpp-0473-owner-context-stale-plugin-file-refusal-v4.test.js test/rpp-0474-owner-context-stale-metadata-refusal-v4.test.js
node --test test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js test/rpp-0500-arbitrary-plugin-fixture-package-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0287-local-plugin-data-stale-owner-context-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0287
test reported 2 subtests ok, 0 failed. The adjacent stale owner-context tests
reported 6 subtests ok, 0 failed. The adjacent release-verifier tests reported
17 subtests ok, 0 failed. Checklist lint returned `"ok": true`; the scoped
artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This is local release-verifier support evidence only. The emitted proof is
hash-only and explicitly productionBacked `false`; final release remains NO-GO
until live production-backed proof satisfies the broader release boundary.
