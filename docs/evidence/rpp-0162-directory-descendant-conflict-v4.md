# RPP-0162 directory descendant conflict variant 4

Status: focused generated-harness proof added for variant 4. Release remains
NO-GO.

## Scenario

Variant 4 adds an explicit `directoryDescendantConflictVariant4` target coverage
surface for generated local directory deletes. The target tag is emitted for
ready deletes where the remote directory has no descendant and non-ready cases
where the remote creates a descendant beneath the directory before push apply.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags the directory descendant
  target with `directory-descendant-v4`, plus ready and non-ready variant-4
  tags, and exposes `summary.targetCoverage.directoryDescendantConflictVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0162 directory descendant
  conflict variant 4 exposes per-tier generated coverage`.
- The focused test recounts all variant-4 target cases, cross-checks the
  summary total, per-tier counts, and statuses, then selects one ready directory
  delete case and one non-ready descendant conflict case.
- The ready selected case proves the planned directory delete applies, preserves
  unplanned remote data, and rejects stale replay before mutation.
- The non-ready selected case proves the remote descendant remains
  `keep-remote`, the directory delete has no planned mutation, `applyPlan()`
  refuses with `PLAN_NOT_READY`, and the remote digest is unchanged.
- The generated model evidence stores only resource keys, counts, hashes,
  decision hashes, conflict hashes, and refusal hashes. It omits the generated
  remote descendant file payload.

Deterministic target shape observed locally:

```json
{
  "directoryDescendantConflictVariant4": {
    "family": "directory-descendant-conflict-variant4",
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
      "conflict": 10,
      "ready": 10
    }
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready directory delete case and one non-ready descendant conflict case",
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
node --test --test-name-pattern=RPP-0162 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Generated summary target check:

```sh
node --input-type=module -e "import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js'; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, directoryDescendantConflictVariant4: summary.targetCoverage.directoryDescendantConflictVariant4 }, null, 2));"
```

Observed summary result: 620 total cases, statuses `{ blocked: 74, conflict:
201, ready: 345 }`, and 20 `directoryDescendantConflictVariant4` cases across
tiers 0 through 9.

Adjacent directory descendant regression command:

```sh
node --test --test-name-pattern='RPP-0102|RPP-0122|RPP-0142|RPP-0162' test/generated-push-harness.test.js
```

Observed adjacent result: 3 subtests, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed generated harness result: 67 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0162-directory-descendant-conflict-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed hygiene result: all commands exited 0; the redaction scan reported no
rejected files for the changed docs.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
