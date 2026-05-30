# RPP-0435 remote plugin removal refusal evidence

Date: 2026-05-30

## Scope

This is variant-2 focused plugin-driver evidence for remote owner-plugin
removal. It covers planner refusal before mutation and executor refusal when a
previously ready plugin-owned row update is replayed after the live remote owner
plugin metadata disappears.

## Proof surface

`test/rpp-0435-remote-plugin-removal-refusal.test.js` proves:

- a plugin-owned `wp_options` row update is blocked before mutation when the
  live remote no longer has the owner plugin metadata from the pull base;
- the blocker uses `REMOTE_PLUGIN_REMOVAL_OWNER_CONTEXT` evidence with
  `operation: refuse-before-mutation`;
- the release-gate note is explicit: `proofScope: local-focused`,
  `productionBacked: false`, and production-backed release-gate evidence is
  still required;
- the planner emits no row mutation for the plugin-owned data and keeps the
  remote plugin-removal decision; and
- a ready plan created while the owner plugin is present refuses at apply time
  with `STALE_PLUGIN_OWNER_CONTEXT` when the live remote plugin metadata is
  removed before apply. The `beforeMutation` hook is not reached, and the remote
  plugin-owned option row remains byte-for-byte unchanged.

The focused assertions check that planner blocker evidence and executor error
details remain hash-only for private fixture values.

## Focused verification observed locally

```sh
node --test test/rpp-0435-remote-plugin-removal-refusal.test.js
node --test test/rpp-0435-remote-plugin-removal-refusal.test.js test/plugin-remote-removal-refusal.test.js test/plugin-uninstall-delete-refusal.test.js
node --test test/plugin-owner-context-file-refusal.test.js test/plugin-owner-context-metadata-refusal.test.js
node --test test/plugin-driver-*.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0435-remote-plugin-removal-refusal.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The RPP-0435 focused test reported 2
subtests ok, 0 failed. The combined plugin-removal command reported 10 subtests
ok, 0 failed. The owner-context file/metadata regressions reported 9 subtests
ok, 0 failed. The plugin-driver regression glob reported 31 subtests ok, 0
failed. Checklist lint returned `"ok": true`; the scoped artifact redaction scan
returned `"ok": true`.

## Release posture

This is local focused proof only. The release-gate evidence in the plan states
`productionBacked: false` and records that production-backed release-gate
evidence is still required before this proof can be treated as live production
release evidence.
