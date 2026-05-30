# RPP-0474 owner context stale metadata refusal v4 evidence

Date: 2026-05-30
Lane: RPP-0474 owner context stale metadata refusal, variant 4
Checklist item: RPP-0474 — Add focused regression coverage for owner context stale metadata refusal, variant 4.

## Scope

This is local focused plugin-driver regression coverage for stale owner plugin
metadata. It validates existing planner/apply behavior for a plugin-owned
`wp_postmeta` row using the `wp-postmeta` driver; it does not claim live
external production evidence.

## Proof surface

`test/rpp-0474-owner-context-stale-metadata-refusal-v4.test.js` covers:

- planner refusal when local attempts to update a plugin-owned `wp_postmeta` row
  but the live remote `plugin:forms` metadata changed after the pull base;
- `stale-plugin-owner-context` blocker evidence with
  `STALE_PLUGIN_METADATA_OWNER_CONTEXT`, `refuse-before-mutation`, the blocked
  `PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED` audit decision, and deterministic
  SHA-256 context hashes;
- apply-time replay refusal when a ready plan is reused after live owner plugin
  metadata drift, yielding `STALE_PLUGIN_OWNER_CONTEXT` before the mutation hook
  runs; and
- preservation of the plugin-owned remote row: before/after row hashes and
  before/after remote hashes are equal on both planner-blocked and apply-replay
  paths.

The proof envelopes record only resource keys, owner/driver labels, reason
codes, summary counts, SHA-256 hashes, and redaction flags. Raw postmeta payloads
and raw remote plugin metadata are asserted absent from blocker evidence, error
details, and proof envelopes.

## Focused verification observed locally

```sh
node --check test/rpp-0474-owner-context-stale-metadata-refusal-v4.test.js
node --test test/rpp-0474-owner-context-stale-metadata-refusal-v4.test.js
node --test test/rpp-0434-owner-context-stale-metadata-refusal.test.js test/plugin-owner-context-metadata-refusal.test.js test/plugin-driver-postmeta-semantics.test.js test/rpp-0465-wp-postmeta-driver-semantics-v4.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0474-owner-context-stale-metadata-refusal-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0474 test
reported 2 subtests ok, 0 failed. The adjacent owner-context / plugin-driver
metadata refusal slice reported 16 subtests ok, 0 failed. Checklist lint
returned `"ok": true`; the scoped artifact redaction scan returned `"ok": true`.

## Release posture

This remains local focused regression evidence only. It is not production-backed
release evidence; the release recommendation remains NO-GO until the separate
production-backed release gates are satisfied.
