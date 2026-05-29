# RPP-0411 plugin uninstall/delete refusal evidence

Date: 2026-05-29

## Scope

This is variant-1 focused plugin-driver evidence for refusing plugin uninstall
and delete paths before mutation. It covers plugin metadata, package files under
`wp-content/plugins/`, and plugin-owned rows whose driver policy does not
support delete.

## Proof surface

`test/plugin-uninstall-delete-refusal.test.js` proves:

- local plugin metadata deletion produces a blocked plan with
  `plugin-uninstall-delete-refusal` and
  `PLUGIN_UNINSTALL_DELETE_REFUSED` evidence;
- local plugin package file deletion produces the same refusal class and keeps
  package file contents out of blocker evidence;
- a plugin-owned `wp_options` row deletion is refused by the driver path with
  `PLUGIN_OWNED_RESOURCE_DELETE_UNSUPPORTED` and no row value in evidence;
- forged ready-plan plugin metadata deletion is rejected by the executor before
  mutation with `PLUGIN_UNINSTALL_DELETE_REFUSED`;
- forged ready-plan plugin package file deletion is rejected by the executor
  before mutation with the same reason code and the owning plugin slug derived
  from the file resource key; and
- non-delete plugin metadata and plugin-owned data updates remain ready and
  apply through the existing driver path.

The focused assertions preserve audit-safe behavior by checking that planner
blockers omit raw option values and package file payloads. Executor assertions
also compare the remote snapshot before and after forged apply attempts to prove
the refusal happens before mutation.

## Focused verification observed locally

```sh
node --test test/plugin-uninstall-delete-refusal.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0411-plugin-uninstall-delete-refusal.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0. The focused plugin uninstall/delete
test reported 6 subtests ok, 0 failed; checklist lint returned `"ok": true`;
the scoped artifact redaction scan returned `"ok": true`.

## Release posture

This remains focused plugin-driver refusal evidence. It is not a live
production release proof and does not update `progress.html`.
