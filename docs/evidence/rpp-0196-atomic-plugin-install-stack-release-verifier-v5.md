# RPP-0196 atomic plugin install stack release verifier v5

Date: 2026-05-31
Lane: RPP-0196 atomic plugin install stack release-verifier carry-through, variant 5
Checklist item: RPP-0196 - Carry through the release verifier for atomic plugin install stack, variant 5.

## Scope

This adds local generated-harness release-verifier carry-through for the atomic
plugin install stack. The variant-5 target tag is emitted on both generated
ready stack installs and generated non-ready missing-dependency stacks.

The proof is local/support-only. It does not broaden the checked live
production boundary and final release posture remains NO-GO without separate
production-backed release evidence.

## Proof surface

`test/rpp-0196-atomic-plugin-install-stack-release-verifier-v5.test.js` proves
that the release verifier:

- exposes `atomicPluginInstallStackReleaseVerifierVariant5` target coverage
  with 20 generated cases across tiers 0 through 9;
- includes 10 ready cases and 10 non-ready missing-dependency cases for the
  target;
- applies the ready stack only when the dependency plugin file, dependent
  plugin file, both plugin metadata records, and plugin-owned option row are in
  one ready atomic group;
- carries same-group dependency evidence for the dependency plugin and
  plugin-owned `wp-option` owner/driver evidence for the install option row;
- rejects stale dependency replay with `PRECONDITION_FAILED` before mutation;
- refuses missing-dependency plans with `PLAN_NOT_READY`, no mutation callback,
  and unchanged remote hashes; and
- keeps evidence hash-only, excluding generated plugin file contents, raw
  option payload fields, and the private install option token.

Observed deterministic target shape:

```json
{
  "target": "atomicPluginInstallStackReleaseVerifierVariant5",
  "family": "atomic-plugin-install-stack-release-verifier-v5",
  "total": 20,
  "perTier": {
    "0": 2,
    "1": 2,
    "2": 2,
    "3": 2,
    "4": 2,
    "5": 2,
    "6": 2,
    "7": 2,
    "8": 2,
    "9": 2
  },
  "statuses": {
    "blocked": 2,
    "conflict": 8,
    "ready": 10
  }
}
```

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/rpp-0196-atomic-plugin-install-stack-release-verifier-v5.test.js
node --test test/rpp-0196-atomic-plugin-install-stack-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0116|RPP-0136|RPP-0156|RPP-0176|RPP-0196' test/generated-push-harness.test.js test/rpp-0196-atomic-plugin-install-stack-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0196-atomic-plugin-install-stack-release-verifier-v5.md
git diff --check
```

Observed focused result: RPP-0196 reported 2 subtests, 0 failures.

Observed adjacent atomic result: RPP-0116, RPP-0136, RPP-0156, RPP-0176, and
RPP-0196 reported 6 subtests, 0 failures.

Observed hygiene result: syntax checks exited 0, the scoped artifact redaction
scan returned `"ok": true`, and `git diff --check` reported no whitespace
errors.
