# RPP-0140 large ready plan tier variant 2

Status: focused generated-harness proof added for variant 2. Release remains NO-GO.

## Scenario

Variant 2 proves the existing `largeReadyPlanTier` generated-harness target from
the deterministic case roster. The target is every `large-ready-plan-tier` case:
one ready plan in each tier combining post-row creates, updates, and deletes;
file creates, updates, and deletes; same-plan taxonomy/comment graph rows; and
remote-only row/file drift.

## Evidence surface

- `test/generated-push-harness.test.js` adds `RPP-0140 large ready plan tier variant 2 proves ready surface and invariant`.
- The focused proof independently recounts all 10 target cases and cross-checks
  `summary.targetCoverage.largeReadyPlanTier` for total, per-tier, and status
  counts.
- For every tier, the proof records exact surface counts for the generated
  post-row, file, taxonomy, comment, and remote-only resources. It verifies that
  the planned mutation keys and live-remote precondition keys exactly match the
  generated local surface.
- The proof applies each plan, verifies all planned resources take the local
  hash, verifies the remote-only row/file keep their remote hashes through
  `keep-remote` decisions, and drifts a non-initial planned resource after
  dry-run. The stale replay must reject with `PRECONDITION_FAILED` while the
  full remote digest stays unchanged.
- The generated model evidence stores only counts, resource keys, hashes,
  precondition hashes, decision hashes, and error-detail hashes. It omits raw
  generated row titles, generated file payloads, remote-only payloads, and stale
  replay payloads.

Deterministic target shape observed locally:

```json
{
  "largeReadyPlanTier": {
    "family": "large-ready-plan-tier",
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
    "cases": 10,
    "perTierSelection": "one large ready plan case per tier 0 through 9",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0140 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Broader generated harness command run locally:

```sh
npm run test:generated-push-harness
```

Observed broader result: the RPP-0140 subtest succeeded inside the suite, but
the full command exited 1 because the pre-existing RPP-0117 stale-remote target
count assertion reported actual 344 versus expected 354. That stale-remote
count is outside this large-ready-plan slice and was not changed here.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
