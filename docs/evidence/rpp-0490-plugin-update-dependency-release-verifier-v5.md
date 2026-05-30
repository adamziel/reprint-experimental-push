# RPP-0490 plugin update dependency release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0490 plugin update dependency validator release verifier carry-through, variant 5
Checklist item: RPP-0490 — Carry through the release verifier for plugin update dependency validator, variant 5.

## Scope

This adds focused release-verifier carry-through for the plugin update
dependency validator. The verifier now emits a hash-only
`pluginUpdateDependencyValidator` proof beside the plugin-driver release
evidence. The proof records whether the dependency evidence is local/support-only
or production-backed.

This lane does not claim live production release movement. The default verifier
proof is local/support-only and keeps the release gate at NO-GO until checked
production evidence is supplied.

## Proof surface

`test/rpp-0490-plugin-update-dependency-release-verifier-v5.test.js` verifies
that the release verifier:

- builds a ready atomic plugin update plan for
  `reprint-push-atomic-dependent-fixture` with a live-remote dependency
  requirement on `reprint-push-atomic-dependency-fixture`;
- carries the dependency `expectedVersion`, supported version range,
  live-remote hash, requirement hash, update mutation hash, and plugin-owned
  data evidence without raw fixture values;
- applies the valid update while preserving the dependency plugin state and
  applying the plugin-owned data row;
- refuses forged ready plans with dependency version mismatch and unsupported
  range errors before mutation;
- refuses stale live dependency evidence with `ATOMIC_GROUP_DEPENDENCY_STALE`
  while preserving the dependency plugin, plugin-owned row, and whole remote
  hashes; and
- distinguishes local/support-only evidence from production-scoped and checked
  production-backed evidence in the release-gate note and status.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0490-plugin-update-dependency-release-verifier-v5.test.js
node --test test/rpp-0490-plugin-update-dependency-release-verifier-v5.test.js
node --test --test-name-pattern 'RPP-0450|RPP-0469|RPP-0470' test/push-planner.test.js
node --test test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0490-plugin-update-dependency-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0490
test reported 3 subtests ok and 0 failed. The adjacent plugin update and
dependency validator slice reported 3 subtests ok and 0 failed. The adjacent
release-verifier plugin-driver slice reported 10 subtests ok and 0 failed.
Checklist lint returned `"ok": true`; the scoped artifact redaction scan
returned `"ok": true` for the touched docs.

## Release posture

NO-GO for final release movement from this slice alone. The emitted
`pluginUpdateDependencyValidator` proof is local/support-only by default and
productionBacked `false`; a checked production release verifier boundary is
still required before this evidence can satisfy a release gate.
