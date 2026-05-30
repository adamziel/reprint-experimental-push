# RPP-0267 local plugin data stale owner context v4 evidence

Date: 2026-05-30
Lane: RPP-0267 local plugin data with stale owner context, variant 4
Checklist item: RPP-0267 — Add focused regression coverage for local plugin data with stale owner context, variant 4.

## Scope

This is focused local regression evidence for plugin-owned data guarded by live
owner context. The fixture plans one `wp-option` row mutation owned by
`rpp-0267-owner-context`; the plan carries owner context for both the owning
plugin file and plugin metadata. The release posture remains NO-GO because this
is local evidence only.

## Proof surface

`test/rpp-0267-local-plugin-data-stale-owner-context-v4.test.js` proves:

- the ready baseline plans one local plugin-owned `wp_options` mutation with one
  live-remote precondition and hash-only plugin driver audit evidence;
- changing the live owner plugin file after planning is rejected by
  `applyPlan()` with `STALE_PLUGIN_OWNER_CONTEXT` before any mutation hook runs;
- changing the live owner plugin metadata after planning is rejected with the
  same code before mutation; and
- forged ready plans that remove all owner-context evidence, omit only the stale
  file context entry, or mismatch a context key and resource object are rejected
  before mutation.

The executor hardening in `src/apply.js` no longer trusts a forged empty
`ownerContextHash` alone. It derives live owner context resources from the
remote snapshot and requires every live owner plugin file or plugin metadata
resource to be represented by valid owner-context evidence before a plugin-owned
mutation can proceed.

## Evidence discipline

The test records only resource keys, refusal codes, mutation counts, before-hook
counts, SHA-256 hashes, and proof hashes. Raw fixture row modes, owner file
markers, and owner metadata markers are asserted absent from serialized proof
objects with `assertEvidenceHasNoRawValues()`.

## Focused verification observed locally

```sh
node --check src/apply.js
node --check test/rpp-0267-local-plugin-data-stale-owner-context-v4.test.js
node --check test/rpp-0247-local-plugin-data-stale-owner-context-v3.test.js
node --test test/rpp-0267-local-plugin-data-stale-owner-context-v4.test.js
node --test test/plugin-owner-context-metadata-refusal.test.js test/plugin-owner-context-file-refusal.test.js test/plugin-remote-removal-refusal.test.js test/rpp-0247-local-plugin-data-stale-owner-context-v3.test.js test/rpp-0433-owner-context-stale-plugin-file-refusal.test.js test/rpp-0434-owner-context-stale-metadata-refusal.test.js test/rpp-0435-remote-plugin-removal-refusal.test.js test/rpp-0473-owner-context-stale-plugin-file-refusal-v4.test.js test/rpp-0474-owner-context-stale-metadata-refusal-v4.test.js test/rpp-0475-remote-plugin-removal-refusal-v4.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0267-local-plugin-data-stale-owner-context-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0267 test
reported 2 subtests ok and zero failures; checklist lint returned `"ok": true`;
the scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This remains local regression evidence. It does not add production-backed live
release evidence, does not update progress surfaces, and keeps the broader
release gate at NO-GO.
