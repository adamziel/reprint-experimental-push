# RPP-0450 plugin update dependency validator variant 3 evidence

Date: 2026-05-31
Lane: RPP-0450 plugin update dependency validator, variant 3
Checklist item: RPP-0450 - Add generated coverage for plugin update dependency validator, variant 3.

## Scope

This is local plugin-driver support evidence for generated-style plugin update
dependency validation. It adds a standalone Node test and does not change
production code, generated-harness ownership files, progress surfaces, or
release checklist state.

Final release remains `NO-GO`. This proof is not live external production
evidence.

## Proof surface

`test/rpp-0450-plugin-update-dependency-validator-v3.test.js` proves:

- a `plugin-update` atomic group for
  `reprint-push-atomic-dependent-fixture` declares the
  `reprint-push-atomic-dependency-fixture` dependency with exact version,
  supported version range, active-state, resource key, and live-remote hash
  evidence;
- dependency metadata, plugin-owned data audit evidence, and emitted proof
  envelopes are hash-only and omit raw dependency metadata, plugin-owned option
  values, and `option_value` fields;
- a satisfied live-remote dependency allows local apply to update the dependent
  plugin and the plugin-owned `wp_options` row while preserving the dependency
  plugin;
- missing live-remote dependency evidence refuses before mutation and preserves
  the plugin-owned remote row;
- stale live-remote dependency evidence refuses with
  `ATOMIC_GROUP_DEPENDENCY_STALE` before mutation and preserves the drifted
  dependency plugin, dependent plugin, plugin-owned remote row, and whole
  remote hash;
- invalid planner metadata blocks planning with
  `incompatible-plugin-dependency-version`; and
- forged ready plugin update dependency evidence, including missing hash
  evidence, forged exact version requirements, and unsupported version ranges,
  fails closed before mutation.

The proof evidence records `evidenceScope: local/support-only`,
`productionBacked: false`, and a release gate note that checked
production-backed evidence is still required.

## Focused verification observed locally

```sh
node --check test/rpp-0450-plugin-update-dependency-validator-v3.test.js
node --test test/rpp-0450-plugin-update-dependency-validator-v3.test.js
node --test --test-name-pattern 'RPP-0450|RPP-0470|RPP-0490' test/push-planner.test.js test/rpp-0490-plugin-update-dependency-release-verifier-v5.test.js
node --test --test-name-pattern 'RPP-0449|RPP-0469|RPP-0489' test/push-planner.test.js test/rpp-0449-plugin-activation-dependency-validator-v3.test.js test/rpp-0489-plugin-activation-dependency-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0450-plugin-update-dependency-validator-v3.md
git diff --check
git diff --cached --check
```

Observed result before commit: all commands exited 0. The focused RPP-0450
test reported 3 subtests ok and 0 failed. The adjacent RPP-0450/RPP-0470/RPP-0490
plugin update dependency slice reported 5 subtests ok and 0 failed. The related
RPP-0449/RPP-0469/RPP-0489 plugin activation dependency slice reported 6
subtests ok and 0 failed. The scoped artifact redaction scan returned
`"ok": true`, and both diff checks returned no whitespace errors.

## Release posture

This lane is local generated-style support evidence only. It proves exact,
hash-only plugin update dependency validation and pre-mutation refusal for
invalid, missing, and stale dependency evidence, but it does not provide checked
production-backed release evidence. Final release remains `NO-GO`.
