# RPP-0178 same independent content variant 4

Status: focused generated-harness proof added for variant 4. Release remains
NO-GO.

## Scenario

Variant 4 adds an explicit `sameIndependentContentVariant4` target coverage
surface for ready generated cases where local and remote independently update
the same `wp_posts` row to identical content. The ready plan should apply while
leaving the already-synchronized row on the remote hash, avoiding any mutation
or live-remote precondition for that row, and preserving every unplanned remote
resource.

## Evidence surface

- `scripts/harness/generated-push-cases.js` exposes
  `summary.targetCoverage.sameIndependentContentVariant4` with the
  `same-independent-content-variant4` family label.
- `test/generated-push-harness.test.js` adds `RPP-0178 same independent content
  variant 4 applies ready cases without unplanned remote overwrite`.
- The focused proof independently recounts all matching target cases,
  cross-checks total, per-tier counts, and statuses against the generated
  summary, and cross-checks the variant-4 shape against legacy and variant-3
  same-independent-content coverage.
- For every selected case, the proof applies the ready plan, verifies the
  shared row keeps the remote hash with no mutation or precondition, verifies
  every planned mutation is applied, and enumerates the applied site to prove
  every unplanned resource still matches the remote hash.
- The generated model evidence stores only resource keys, counts, row hashes,
  decision hashes, apply-proof hashes, and unplanned-preservation proof hashes.
  It omits raw row titles and generated payload values.

Deterministic target shape observed locally:

```json
{
  "sameIndependentContentVariant4": {
    "family": "same-independent-content-variant4",
    "total": 10,
    "perTier": {
      "0": 1,
      "1": 1,
      "2": 1,
      "3": 1,
      "4": 1,
      "5": 1,
      "6": 1,
      "7": 1,
      "8": 1,
      "9": 1
    },
    "statuses": {
      "ready": 10
    }
  },
  "selectedModelEvidence": {
    "selectedCases": 10,
    "selection": "all same independent content variant-4 target cases",
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
node --test --test-name-pattern=RPP-0178 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Adjacent same-independent-content regression command:

```sh
node --test --test-name-pattern='RPP-0118|RPP-0138|RPP-0158|RPP-0178' test/generated-push-harness.test.js
```

Observed adjacent result: 4 subtests, 0 failures.

Required-family cross-check command:

```sh
node --test --test-name-pattern='generated push harness covers|RPP-0178' test/generated-push-harness.test.js
```

Observed cross-check result: 2 subtests, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed full result: 85 subtests, 0 failures.

Hygiene commands:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0178-same-independent-content-v4.md docs/generated-push-harness.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed hygiene result: all commands exited 0; checklist lint returned
`"ok": true`; the scoped redaction scan returned `"ok": true` with 0 rejected
files; both whitespace checks were clean.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
