# RPP-0436 driver delete support flag evidence

Date: 2026-05-30

## Scope

This is variant-2 focused plugin-driver evidence for the per-driver delete
support flag. It extends the existing variant-1 proof with strict flag-shape
coverage and apply-time forgery checks for a plugin-owned `wp_options` row
delete.

## Proof surface

`test/rpp-0436-driver-delete-support-flag.test.js` proves:

- omitted `supportsDelete`, explicit `supportsDelete: false`, false `delete`
  and `allowDelete` aliases, and non-boolean truthy values all fail closed
  before mutation;
- boolean `true` is the only accepted opt-in, whether expressed as
  `supportsDelete: true`, `delete: true`, or `allowDelete: true`;
- unsupported deletes produce zero mutations and a
  `PLUGIN_DRIVER_DELETE_UNSUPPORTED` refusal with `rawValuesIncluded: false`;
- allowed deletes carry `supportsDelete: true` into
  `mutation.pluginOwnedResource` and remove only the owned row while preserving
  the active plugin state; and
- forged ready plans whose delete mutation lacks the explicit boolean opt-in
  are refused by apply before mutating the remote snapshot.

The focused assertions use a raw row sentinel and verify that planner blockers,
delete-support refusal evidence, mutation audit evidence, and apply refusal
details do not expose row payload fields or values.

## Focused verification observed locally

```sh
node --test test/rpp-0436-driver-delete-support-flag.test.js
node --test test/plugin-driver-delete-support-flag.test.js
node --test --test-name-pattern 'RPP-0436|plugin-owned deletes' \
  test/rpp-0436-driver-delete-support-flag.test.js \
  test/plugin-driver-delete-support-flag.test.js
node --test test/plugin-driver-audit-redaction.test.js test/plugin-uninstall-delete-refusal.test.js
node --test --test-name-pattern 'delete driver|uninstall/delete' test/push-planner.test.js
node --test --test-name-pattern 'driver delete' test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs \
  docs/evidence/rpp-0436-driver-delete-support-flag.md \
  docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all completed commands exited 0. The new RPP-0436 focused test
reported 12 tests ok, 0 failed; the existing delete-support regression reported
3 tests ok, 0 failed; the combined focused pattern reported 15 tests ok, 0
failed; the adjacent audit-redaction and uninstall/delete regressions reported
9 tests ok, 0 failed; the focused push-planner delete-driver regressions
reported 3 tests ok, 0 failed across two pattern runs; checklist lint returned
`"ok": true`; and the scoped artifact redaction scan returned `"ok": true`.

## Release posture

This remains focused local plugin-driver evidence only. It does not update
`progress.html` and does not claim live external production release readiness.
