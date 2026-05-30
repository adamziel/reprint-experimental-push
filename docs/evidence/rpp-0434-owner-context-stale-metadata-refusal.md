# RPP-0434 owner context stale metadata refusal evidence

Date: 2026-05-30
Lane: RPP-0434 owner context stale metadata refusal, variant 2
Checklist item: RPP-0434 — Prove owner context stale metadata refusal, variant 2.

## Invariant

A plugin-owned data mutation must be refused before any remote mutation when the
owning plugin metadata changed on the live remote after the pull base. The proof
must preserve the remote plugin-owned row and expose only hash-based audit
evidence for the stale owner context.

## Evidence added

- Focused planner refusal coverage in
  `test/rpp-0434-owner-context-stale-metadata-refusal.test.js` proves a local
  plugin-owned `wp_options` change emits no mutation when `plugin:forms` drifted
  remotely. The blocker carries `STALE_PLUGIN_METADATA_OWNER_CONTEXT`,
  `refuse-before-mutation`, deterministic context hashes, and a blocked driver
  audit decision.
- Focused stale replay coverage in the same test builds a ready plan, changes
  only the live remote plugin metadata, and verifies apply raises
  `STALE_PLUGIN_OWNER_CONTEXT` before changing the plugin-owned row.
- Both paths assert the remote site hash and plugin-owned row hash are unchanged
  after refusal, while raw local row values and raw remote plugin metadata values
  are absent from the serialized proof envelope.

## Hash-only proof shape

The test records status, summary counts, resource keys, reason codes, SHA-256
hashes, owner-context hashes, blocker hashes, error-detail hashes, and before /
after remote hashes. It does not serialize plugin-owned row payloads or plugin
metadata payloads into the proof envelope.

## Focused verification observed locally

```sh
node --check test/rpp-0434-owner-context-stale-metadata-refusal.test.js
node --test test/rpp-0434-owner-context-stale-metadata-refusal.test.js
node --test test/plugin-owner-context-metadata-refusal.test.js test/plugin-owner-context-file-refusal.test.js test/plugin-remote-removal-refusal.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0434-owner-context-stale-metadata-refusal.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The focused RPP-0434 test reported 2
subtests ok, 0 failed. The adjacent owner-context regression slice reported 11
subtests ok, 0 failed. Checklist lint returned `"ok": true`; the scoped artifact
redaction scan returned `"ok": true`.

## Release posture

This is local Node planner/apply evidence for the plugin-driver slice. It does
not update `progress.html` or claim live external production release readiness.
