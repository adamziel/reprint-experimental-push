# RPP-0176 atomic plugin install stack variant 4

Status: focused generated-harness regression proof added for variant 4.
Release remains NO-GO.

## Scenario

Variant 4 adds an explicit `atomicPluginInstallStackV4` target coverage surface
for the deterministic atomic plugin install stack. The variant-4 tag is emitted
on both stack shapes: ready cases that install the dependency plugin, dependent
plugin, plugin metadata, and plugin-owned option in one atomic group; and
missing-dependency cases that keep the dependent plugin staged without the
required dependency.

The generated summary exposes 20 variant-4 cases across all 10 tiers: 10 ready
cases and 10 non-ready missing-dependency cases. Some non-ready cases also carry
seeded conflict status, but the atomic group remains blocked and still records
the missing dependency and propagated group blockers.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now emits
  `atomic-plugin-install-stack-v4`, `atomic-plugin-stack-ready-v4`, and
  `atomic-plugin-stack-missing-dependency-v4` tags and exposes
  `summary.targetCoverage.atomicPluginInstallStackV4`.
- `test/generated-push-harness.test.js` adds `RPP-0176 atomic plugin install
  stack variant 4 retains focused ready and non-ready regression coverage`.
- The focused test cross-checks summary totals, per-tier counts, ready and
  non-ready counts, and variant-4 tag counts.
- The ready selected case proves the dependency plugin file and metadata are
  installed in the same atomic group and that plugin-owned option data remains
  in the group.
- The non-ready selected case proves the dependency plugin is not synthesized
  outside the local intent, the group records `missing-plugin-dependency`, and
  the atomic blocker propagates to grouped dependent plugin metadata.
- The generated model evidence stores only resource keys, dependency hashes,
  blocker classes, counts, and proof hashes. It omits raw plugin file contents
  and the private install option token.

Deterministic target shape observed locally:

```json
{
  "atomicPluginInstallStackV4": {
    "family": "atomic-plugin-install-stack-variant4",
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
  },
  "featureFamilies": {
    "atomic-plugin-install-stack-v4": 20,
    "atomic-plugin-stack-ready-v4": 10,
    "atomic-plugin-stack-missing-dependency-v4": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready atomic install stack case and one non-ready missing-dependency stack case",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Syntax checks:

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
```

Observed syntax result: both commands exited 0.

Focused command:

```sh
node --test --test-name-pattern=RPP-0176 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Adjacent atomic regression command:

```sh
node --test --test-name-pattern='RPP-0116|RPP-0136|RPP-0156|RPP-0176' test/generated-push-harness.test.js
```

Observed adjacent result: 4 subtests, 0 failures.

Full generated-harness command:

```sh
npm run test:generated-push-harness
```

Observed full generated-harness result: 83 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0176-atomic-plugin-install-stack-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed hygiene result: checklist completion lint returned `"ok": true`, the
scoped redaction scan returned `"ok": true` with 0 rejected files, and both
diff whitespace checks reported no errors.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
