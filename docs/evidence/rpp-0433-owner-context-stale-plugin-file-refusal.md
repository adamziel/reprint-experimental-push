# RPP-0433 owner context stale plugin file refusal evidence

Date: 2026-05-30

## Proof type

This is local focused and local production-shaped evidence. It is not
production-backed. The focused fixture uses a production-shaped `wp_postmeta`
plugin-driver policy with `releaseGateEvidenceScope: local-production-shaped`,
then records only resource keys, statuses, and SHA-256 hashes.

## Scope

`test/rpp-0433-owner-context-stale-plugin-file-refusal.test.js` proves two stale
owner plugin file paths:

- a local production-shaped plugin-owned `wp_postmeta` row applies exactly one
  mutation when the owner plugin file context matches, while the same ready plan
  is refused before mutation if the owner plugin file changes before apply; and
- a plugin file mutation is blocked before mutation when a sibling owner plugin
  file changed on the live remote after the pull base.

Both refusals use `stale-plugin-owner-context` with
`STALE_PLUGIN_FILE_OWNER_CONTEXT` evidence. The evidence envelope is hash-only:
it includes resource keys, change kinds, precondition hashes, owner-context
hashes, and error hashes, but not row payloads or plugin file contents. The
stale remote snapshots are asserted unchanged after refusal.

## Focused verification observed locally

```sh
node --test test/rpp-0433-owner-context-stale-plugin-file-refusal.test.js
node --test test/plugin-owner-context-file-refusal.test.js
node --test test/plugin-owner-context-metadata-refusal.test.js
node --test test/plugin-driver-audit-redaction.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs \
  docs/evidence/rpp-0433-owner-context-stale-plugin-file-refusal.md \
  docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The RPP-0433 focused proof reported 2
subtests ok, 0 failed. The existing owner-context file regression reported 4
subtests ok, 0 failed, and the adjacent metadata/file regression reported 5
subtests ok, 0 failed. The plugin-driver audit redaction regression reported 3
subtests ok, 0 failed. Checklist lint returned `"ok": true`; the scoped artifact
redaction scan returned `"ok": true` for the touched docs.

## Release posture

This evidence is local-only and does not update `progress.html` or assert live
external production coverage.
