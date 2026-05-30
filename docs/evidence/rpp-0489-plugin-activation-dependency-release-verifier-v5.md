# RPP-0489 plugin activation dependency release verifier carry-through v5 evidence

Date: 2026-05-30

## Scope

This is focused release-verifier carry-through evidence for the plugin
activation dependency validator, variant 5. It adds hash-only support evidence
under `pluginDriver.coreSemantics.pluginActivationDependency` so the release
verifier records that stale live-remote dependency evidence refuses before any
activation or plugin-owned row mutation. It does not claim a live production
release run.

## Proof surface

`test/rpp-0489-plugin-activation-dependency-release-verifier-v5.test.js`
proves:

- a ready `plugin-activation` atomic group records a `live-remote` dependency
  requirement for the dependency plugin, including active-state and version
  requirements;
- after planning, remote drift on that dependency causes
  `ATOMIC_GROUP_DEPENDENCY_STALE` before mutation;
- the dependent plugin activation and plugin-owned `wp_options` row update do
  not apply, while the drifted remote row hash and full remote hash are
  preserved; and
- the release-verifier evidence is hash-only and omits raw `option_value`
  payloads and private dependency metadata.

The summary remains `support_only` with `releaseGate: NO-GO` and
`productionBacked: false`; production-backed release evidence is still required
for final release acceptance.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0489-plugin-activation-dependency-release-verifier-v5.test.js
node --test test/rpp-0489-plugin-activation-dependency-release-verifier-v5.test.js
node --test --test-name-pattern "RPP-0469|RPP-0470" test/push-planner.test.js
node --test test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js test/rpp-0489-plugin-activation-dependency-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0489-plugin-activation-dependency-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0489
test reported 2 subtests ok and 0 failed. The adjacent RPP-0469/RPP-0470
plugin dependency slice reported 2 subtests ok and 0 failed. The adjacent
release-verifier slice reported 12 subtests ok and 0 failed.

## Release posture

This lane is local focused release-verifier evidence. The plugin activation
dependency validator now carries a verifier summary showing remote dependency
drift refuses pre-mutation and preserves plugin-owned remote data, but final
release remains `NO-GO` without checked production evidence.
