# RPP-0449 plugin activation dependency validator variant 3 evidence

Date: 2026-05-31
Lane: RPP-0449 plugin activation dependency validator, variant 3
Checklist item: RPP-0449 - Add generated coverage for plugin activation dependency validator, variant 3.

## Scope

This is local plugin-driver support evidence for generated-style plugin
activation dependency validation. It adds a standalone Node test and does not
change production code, generated-harness ownership files, progress surfaces, or
release checklist state.

Final release remains `NO-GO`. This proof is not live external production
evidence.

## Proof surface

`test/rpp-0449-plugin-activation-dependency-validator-v3.test.js` proves:

- a `plugin-activation` atomic group for
  `reprint-push-atomic-dependent-fixture` declares the
  `reprint-push-atomic-dependency-fixture` dependency with explicit
  version, activation, resource key, and live-remote hash evidence;
- dependency metadata and emitted proof envelopes are hash-only and omit raw
  dependency metadata, plugin-owned option values, and `option_value` fields;
- a satisfied live-remote dependency allows local apply to activate the
  dependent plugin and update the plugin-owned `wp_options` row;
- a missing live-remote dependency refuses before mutation and preserves the
  plugin-owned remote row;
- stale live-remote dependency evidence from remote drift refuses with
  `ATOMIC_GROUP_DEPENDENCY_STALE` before mutation and preserves the drifted
  plugin-owned remote row;
- invalid activation dependency metadata blocks planning with
  `incompatible-plugin-dependency-activation`; and
- forged ready activation evidence, including undeclared dependency metadata
  and forged active-state requirements, fails closed before mutation.

## Focused verification observed locally

```sh
node --check test/rpp-0449-plugin-activation-dependency-validator-v3.test.js
node --test test/rpp-0449-plugin-activation-dependency-validator-v3.test.js
node --test --test-name-pattern 'RPP-0469|RPP-0489' test/push-planner.test.js test/rpp-0489-plugin-activation-dependency-release-verifier-v5.test.js
node --test --test-name-pattern 'RPP-0450|RPP-0470|RPP-0490' test/push-planner.test.js test/rpp-0490-plugin-update-dependency-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0449-plugin-activation-dependency-validator-v3.md
git diff --check
git diff --cached --check
```

Observed result before commit: all commands exited 0. The focused RPP-0449
test reported 3 subtests ok and 0 failed. The adjacent RPP-0469/RPP-0489 plugin
activation dependency slice reported 3 subtests ok and 0 failed. The related
RPP-0450/RPP-0470/RPP-0490 dependency validator slice reported 5 subtests ok
and 0 failed. The scoped artifact redaction scan returned `"ok": true`, and
both diff checks returned no whitespace errors.

## Release posture

This lane is local generated-style support evidence only. It proves plugin
activation dependency drift refuses pre-mutation and preserves plugin-owned
remote data, but it does not provide checked production-backed release
evidence. Final release remains `NO-GO`.
