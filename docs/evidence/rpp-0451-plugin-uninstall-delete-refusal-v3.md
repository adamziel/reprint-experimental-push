# RPP-0451 plugin uninstall/delete refusal variant 3 evidence

Date: 2026-05-31
Lane: RPP-0451 plugin uninstall/delete refusal, variant 3
Checklist item: RPP-0451 - Add generated coverage for plugin uninstall/delete refusal, variant 3.

## Scope

This is local plugin-driver support evidence for generated-style plugin
uninstall/delete refusal. It adds a standalone Node test and does not change
production code, generated-harness ownership files, progress surfaces, or
release checklist state.

Final release remains `NO-GO`. This proof is not live external production
evidence.

## Proof surface

`test/rpp-0451-plugin-uninstall-delete-refusal-v3.test.js` proves:

- local plugin metadata deletion and plugin package file deletion emit
  `plugin-uninstall-delete-refusal` blockers with
  `PLUGIN_UNINSTALL_DELETE_REFUSED` and no delete mutations;
- plugin-owned `wp_options` row deletion is refused by the exact matched
  `wp-option` driver when explicit boolean delete support is absent, even when
  a decoy `wp-postmeta` policy entry claims delete support;
- blocked plan apply returns `PLAN_NOT_READY` before mutation and preserves the
  remote plugin-owned row;
- an exact `wp-option` policy entry with explicit checked
  `supportsDelete: true` emits one plugin-owned row delete mutation, carries
  hash-only owner-context and driver audit evidence, applies the row delete,
  and preserves the plugin metadata and package file;
- stale owner-context evidence and stale remote row hashes refuse before
  mutation and preserve remote plugin-owned data;
- forged ready-plan delete evidence with missing owner context refuses before
  mutation; and
- forged plugin uninstall/delete mutations are rejected by apply with
  `PLUGIN_UNINSTALL_DELETE_REFUSED`, even when the forged mutation claims
  delete support.

The test records generated-style proof envelopes with `status: support_only`,
`evidenceScope: local/support-only`, `productionBacked: false`, and
`releaseGate.status: NO-GO`. Assertions stay on resource keys, metadata,
reason codes, support flags, and SHA-256 hashes instead of raw private values.

## Focused verification observed locally

```sh
node --check test/rpp-0451-plugin-uninstall-delete-refusal-v3.test.js
node --test --test-name-pattern RPP-0451 test/rpp-0451-plugin-uninstall-delete-refusal-v3.test.js
node --test test/plugin-uninstall-delete-refusal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0451-plugin-uninstall-delete-refusal-v3.md
git diff --check
```

Observed result before commit: all commands exited 0. The focused RPP-0451
test reported 3 subtests ok and 0 failed. The adjacent plugin uninstall/delete
driver test reported 6 subtests ok and 0 failed. The scoped artifact redaction
scan returned `"ok": true`, and the diff check returned no whitespace errors.

## Release posture

This lane is local generated-style support evidence only. It proves exact
driver delete behavior plus pre-mutation refusal for plugin uninstall/delete,
stale evidence, and forged evidence, but it does not provide checked
production-backed release evidence. Final release remains `NO-GO`.
