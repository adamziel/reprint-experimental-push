# RPP-0179 remote-only preservation variant 4

Status: focused generated-harness regression added for variant 4. Release
remains NO-GO.

## Scenario

Variant 4 proves that mutation-bearing generated `remote-only-post-update`
cases preserve remote-only rows and reject stale remote replay before any
mutation hook can run. Tier 0 remains excluded because it is the zero-mutation
remote-only preservation fixture.

The proof drifts the final planned mutation after dry-run. That gives the test
a non-leading stale resource while preserving earlier planned mutations as a
regression trap. The apply path must fail with `PRECONDITION_FAILED`, report
zero `beforeMutation` calls, and leave the full stale remote digest unchanged.

## Evidence surface

- `test/rpp-0179-remote-only-preservation-v4.test.js` adds the focused
  generated-harness proof for RPP-0179.
- The test selects all mutation-bearing generated remote-only preservation
  cases through existing harness APIs and cross-checks the recount against the
  legacy `remoteOnlyPreservation` target and the variant-3
  `remoteOnlyPreservationVariant3` target.
- For every tier 1 through 9, the proof verifies the remote-only `wp_posts`
  row is a hash-only `keep-remote` decision with no mutation or precondition,
  and that the applied row hash matches the live remote hash.
- For every selected case, the proof drifts the final planned mutation and
  asserts `PRECONDITION_FAILED`, zero `beforeMutation` calls, exact expected and
  actual precondition hashes, and an unchanged full remote digest.
- The evidence stores resource keys, status/tier counts, hashes, mutation
  counts, precondition counts, decision hashes, planned-value hashes,
  precondition hashes, and refusal-detail hashes. It omits generated row
  titles, generated file payloads, and stale replay payload values.

Deterministic target shape observed locally:

```json
{
  "remoteOnlyPreservationVariant4": {
    "family": "remote-only-preservation-variant4",
    "sourceFamily": "remote-only-post-update",
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
    "perTierSelection": "all mutation-bearing remote-only preservation variant-4 generated cases",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Syntax check:

```sh
node --check test/rpp-0179-remote-only-preservation-v4.test.js
```

Observed syntax result: command exited 0.

Focused command:

```sh
node --test test/rpp-0179-remote-only-preservation-v4.test.js
```

Observed focused result: 1 subtest, 0 failures.

Adjacent remote-only generated-harness regression command:

```sh
node --test --test-name-pattern='RPP-0119|RPP-0139|RPP-0159' test/generated-push-harness.test.js
```

Observed adjacent result: 3 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0179-remote-only-preservation-v4.md
git diff --check
git diff --cached --check
```

Observed hygiene result: all commands exited 0; the scoped redaction scan
returned `"ok": true` with 0 rejected files, and whitespace diff check was
clean.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
