# RPP-0159 remote-only preservation variant 3

Status: focused generated-harness proof added for variant 3. Release remains
NO-GO.

## Scenario

Variant 3 adds an explicit `remoteOnlyPreservationVariant3` target coverage
surface for mutation-bearing generated `remote-only-post-update` cases. In each
case the remote changes a `wp_posts` row while local changes affect other
resources. Tier 0 remains a zero-mutation preservation fixture and is excluded
from this stale-replay target because there is no planned mutation to drift
after dry-run.

## Evidence surface

- `scripts/harness/generated-push-cases.js` exposes
  `summary.targetCoverage.remoteOnlyPreservationVariant3` with the
  `remote-only-preservation-variant3` family label.
- `test/generated-push-harness.test.js` adds `RPP-0159 remote-only preservation
  variant 3 rejects stale replay before mutation`.
- The focused test independently recounts every variant-3 target case and
  cross-checks total, per-tier counts, and statuses against the generated
  summary and the legacy `remoteOnlyPreservation` target.
- For each tier 1 through 9, the proof applies the ready plan, verifies the
  remote-only row remains a hash-only `keep-remote` decision with no mutation
  or precondition, and confirms the applied row hash matches the remote hash.
- The proof drifts the final planned mutation after dry-run, then asserts
  `PRECONDITION_FAILED` and an unchanged full remote digest. Because the stale
  target is the final planned mutation, an unchanged digest proves stale replay
  fails before any earlier mutation can run.
- The generated model evidence stores only resource keys, tier/status counts,
  row hashes, decision hashes, planned-value hashes, precondition hashes, and
  refusal-detail hashes. It omits raw row titles, generated local payloads, and
  stale replay payload values.

Deterministic target shape observed locally:

```json
{
  "remoteOnlyPreservationVariant3": {
    "family": "remote-only-preservation-variant3",
    "total": 9,
    "perTier": {
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
      "ready": 9
    }
  },
  "selectedModelEvidence": {
    "cases": 9,
    "perTierSelection": "all mutation-bearing remote-only preservation variant-3 target cases",
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
node --test --test-name-pattern=RPP-0159 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Generated summary target check:

```sh
node --input-type=module - <<'NODE'
import { runGeneratedPushHarness } from './scripts/harness/generated-push-cases.js';
const { summary } = runGeneratedPushHarness();
const target = summary.targetCoverage.remoteOnlyPreservationVariant3;
if (!target || target.family !== 'remote-only-preservation-variant3' || target.total !== 9) {
  throw new Error(`unexpected RPP-0159 target coverage: ${JSON.stringify(target)}`);
}
console.log(JSON.stringify({ totalCases: summary.totalCases, statuses: summary.statuses, target }, null, 2));
NODE
```

Observed summary result: 620 total cases, statuses `{ blocked: 74, conflict:
201, ready: 345 }`, and 9 ready `remoteOnlyPreservationVariant3` cases across
tiers 1 through 9.

Required-family cross-check command:

```sh
node --test --test-name-pattern='generated push harness covers|RPP-0159' test/generated-push-harness.test.js
```

Observed cross-check result: 2 subtests, 0 failures.

Adjacent remote-only regression command:

```sh
node --test --test-name-pattern='RPP-0119|RPP-0139|RPP-0159' test/generated-push-harness.test.js
```

Observed adjacent result: 3 subtests, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed generated harness result: 66 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0159-remote-only-preservation-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed hygiene result: all commands exited 0; the redaction scan reported no
rejected files for the changed docs.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
