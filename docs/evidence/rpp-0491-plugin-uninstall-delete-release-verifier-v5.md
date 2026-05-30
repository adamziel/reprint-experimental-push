# RPP-0491 plugin uninstall/delete release verifier carry-through v5 evidence

Date: 2026-05-30

## Scope

This is focused release-verifier carry-through evidence for plugin
uninstall/delete refusal, variant 5. It adds a hash-only release verifier
summary for plugin metadata deletes, plugin package file deletes, and
plugin-owned row deletes whose driver does not support delete. It does not
claim a live production release run.

## Proof surface

`test/rpp-0491-plugin-uninstall-delete-release-verifier-v5.test.js` proves:

- `production-shaped-release-verify.mjs` emits
  `pluginDriver.uninstallDeleteRefusal` beside the existing plugin-driver
  release verifier summaries;
- the focused RPP-0491 verifier proof keeps local/support-only evidence at
  `releaseGate.status: NO-GO`;
- planner output refuses plugin metadata delete and package file delete with
  `PLUGIN_UNINSTALL_DELETE_REFUSED`;
- planner output refuses the plugin-owned `wp_options` row delete with
  `PLUGIN_OWNED_RESOURCE_DELETE_UNSUPPORTED` and the exact `wp-option` driver;
- blocked-plan apply preserves the remote snapshot before mutation; and
- forged ready plugin metadata and package file deletes are rejected by the
  executor with `PLUGIN_UNINSTALL_DELETE_REFUSED` before mutation.

The summary includes only resource keys, refusal classes, reason codes, driver
labels, support flags, counts, and SHA-256 hashes. The focused assertions check
that raw plugin version strings, package file contents, option payloads,
`option_value` fields, and forged apply details stay out of serialized
evidence.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0491-plugin-uninstall-delete-release-verifier-v5.test.js
node --test test/rpp-0491-plugin-uninstall-delete-release-verifier-v5.test.js
node --test test/plugin-uninstall-delete-refusal.test.js
node --test --test-name-pattern 'plugin uninstall/delete|RPP-0471 plugin uninstall/delete' test/push-planner.test.js
node --test test/rpp-0481-driver-registration-api-release-verifier-v5.test.js test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js test/rpp-0491-plugin-uninstall-delete-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0491-plugin-uninstall-delete-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0491
test reported 2 subtests ok and 0 failed. The adjacent uninstall/delete slice
reported the expected focused subtests ok, and the adjacent release-verifier
slice reported the selected v5 subtests ok. Checklist lint returned
`"ok": true`, and the scoped artifact redaction scan returned `"ok": true` for
the touched docs.

## Release posture

This lane is local focused release-verifier/plugin-driver evidence. Plugin
uninstall/delete refusal remains release-gate `NO-GO` until separate live
production-backed release evidence is captured and accepted by the release gate.
