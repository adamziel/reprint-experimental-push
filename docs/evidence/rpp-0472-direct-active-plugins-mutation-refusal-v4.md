# RPP-0472 direct active_plugins mutation refusal v4 evidence

Date: 2026-05-30
Lane: RPP-0472 direct active_plugins mutation refusal, variant 4
Checklist item: RPP-0472 — Add focused regression coverage for direct active_plugins mutation refusal, variant 4.

## Scope

This is local generated regression evidence for the direct `active_plugins`
mutation refusal path. It validates existing planner/apply behavior only; it
does not add a production activation driver and does not change the release
posture.

## Proof surface

`test/rpp-0472-direct-active-plugins-mutation-refusal-v4.test.js` imports
`generateDirectActivePluginsMutationRefusalCases()` from the generated harness
and proves three variants:

- a supported plugin-managed `wp-option` row update for owner `forms`, kept
  distinct from the unchanged `row:["wp_options","option_name:active_plugins"]`
  resource;
- a direct local edit to the `active_plugins` option row that the planner blocks
  with class `unsupported-active-plugins-direct-mutation`, reason code
  `DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED`, required driver
  `plugin-activation-driver`, zero mutations, and zero preconditions; and
- a forged ready plan containing an `active_plugins` mutation, rejected by
  `applyPlan()` as `UNSUPPORTED_ACTIVE_PLUGINS_MUTATION` before any mutation
  hook runs.

The test asserts remote hashes are unchanged for refused paths, the supported
plugin-managed row applies exactly one mutation while preserving the
`active_plugins` row hash, and all blocker/proof evidence is hash-only with the
generated private markers absent.

## Focused verification observed locally

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0472-direct-active-plugins-mutation-refusal-v4.test.js
node --test test/rpp-0472-direct-active-plugins-mutation-refusal-v4.test.js
node --test test/plugin-driver-audit-redaction.test.js test/plugin-driver-delete-support-flag.test.js test/plugin-driver-dry-run-validation-hook.test.js test/plugin-uninstall-delete-refusal.test.js
node --test --test-name-pattern 'production plugin-driver boundary proof rejects active_plugins and unowned option mutations|production plugin-driver boundary proof rejects direct plugin activation and update mutations|production plugin-driver boundary proof rejects serialized plugin-owned option mutations' test/production-shaped-proof.test.js
node --test test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0472-direct-active-plugins-mutation-refusal-v4.md docs/reprint-push-completion-checklist.md

git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0472 test
reported 3 subtests ok and zero failures; checklist lint returned `"ok": true`;
the scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This remains local generated plugin-driver regression evidence only. It is not
live external production evidence, does not update `progress.html`, and keeps
the broader release gate at NO-GO.
