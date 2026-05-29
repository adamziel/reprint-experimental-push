# RPP-0416 driver delete support flag evidence

Date: 2026-05-29

## Scope

This is variant-1 focused plugin-driver evidence for the per-driver delete
support flag. It covers the fail-closed default and the explicit opt-in path
for a plugin-owned `wp_options` row delete.

## Proof surface

`test/plugin-driver-delete-support-flag.test.js` proves:

- a plugin-owned row delete is blocked before mutation when the matched
  `wp-option` driver policy omits `supportsDelete`;
- the refusal records `PLUGIN_DRIVER_DELETE_UNSUPPORTED`, attempted action
  `delete`, the resource key, plugin owner, driver, and `supportsDelete: false`;
- the blocked plan carries no mutation for the deleted resource, and apply
  refuses the blocked plan while leaving the remote snapshot unchanged;
- row payload details are not serialized into the blocker evidence;
- the same delete becomes a ready `delete` mutation only when the matched
  driver policy explicitly sets `supportsDelete: true`, and apply removes the
  row while preserving the active plugin state; and
- forged ready plans whose plugin-owned delete mutation is missing the explicit
  `supportsDelete: true` opt-in are refused by apply before remote mutation.

The implementation path normalizes `supportsDelete` from plugin-owned resource
policy entries, propagates it into `mutation.pluginOwnedResource`, blocks
planner deletes when the flag is absent or false, and has the executor reject
forged plugin-owned delete mutations that do not carry the explicit opt-in.

## Focused verification observed locally

```sh
npm test -- --test-name-pattern='plugin-owned deletes' test/plugin-driver-delete-support-flag.test.js
npm test -- test/plugin-driver-delete-support-flag.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0416-driver-delete-support-flag.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The focused driver delete support test
reported 3 subtests ok, 0 failed; checklist lint returned `"ok": true`; the
scoped artifact redaction scan returned `"ok": true`.

## Release posture

This remains focused local plugin-driver evidence only. It does not update
`progress.html` and does not claim live external production release readiness.
