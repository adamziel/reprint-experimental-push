# RPP-0153 wp_term_relationships graph variant 3

Status: focused generated-harness proof added for variant 3. Release remains
NO-GO.

## Scenario

Variant 3 adds an explicit `wpTermRelationshipsGraphVariant3` target coverage
surface for deterministic `wp_terms` + `wp_term_taxonomy` +
`wp_term_relationships` graph changes. The variant-3 tag is emitted on the
existing relationship graph target cases so the generated summary exposes the
surface with per-tier counts and both ready and stale non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags relationship graph cases
  with `wp-term-relationships-graph-v3` plus ready/stale/non-ready variant-3
  tags and exposes `summary.targetCoverage.wpTermRelationshipsGraphVariant3`.
- `test/generated-push-harness.test.js` adds `RPP-0153 wp_term_relationships
  graph variant 3 records ready apply and stale non-ready coverage`.
- The focused test recounts all variant-3 target cases, cross-checks summary
  total, per-tier counts, and statuses, and selects one ready case plus one
  stale non-ready case for invariant checks.
- The ready selected case proves the generated term, taxonomy, and relationship
  creates each carry matching preconditions, apply the local hashes, preserve
  the unplanned remote-only file, and reject stale replay with
  `PRECONDITION_FAILED` before mutation.
- The stale selected case proves the new relationship row remains blocked on
  the stale taxonomy reference, refuses apply with `PLAN_NOT_READY`, and leaves
  the remote digest unchanged.
- The generated model evidence stores only resource keys, term-id hashes,
  taxonomy/description hashes, relationship field hashes, blocker hashes,
  refusal hashes, and remote-only preservation hashes. It omits raw term names,
  slugs, taxonomy descriptions, stale taxonomy drift values, and remote-only
  file contents.

Deterministic target shape observed locally:

```json
{
  "wpTermRelationshipsGraphVariant3": {
    "family": "wp-term-relationships-graph-variant3",
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
      "blocked": 5,
      "ready": 5
    }
  },
  "featureFamilies": {
    "wp-term-relationships-graph-v3": 10,
    "wp-term-relationships-graph-v3-ready": 5,
    "wp-term-relationships-graph-v3-stale": 5,
    "wp-term-relationships-graph-v3-non-ready": 5
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready relationship graph case and one stale non-ready relationship graph case",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

Focused command:

```sh
node --test --test-name-pattern=RPP-0153 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Required-family cross-check command:

```sh
node --test --test-name-pattern='generated push harness covers|RPP-0153' test/generated-push-harness.test.js
```

Observed cross-check result: 2 subtests, 0 failures.

Adjacent baseline regression command:

```sh
node --test --test-name-pattern='RPP-0113|RPP-0133' test/generated-push-harness.test.js
```

Observed adjacent result: 1 subtest, 0 failures.

Full generated harness command:

```sh
npm run test:generated-push-harness
```

Observed full result: 61 subtests, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
