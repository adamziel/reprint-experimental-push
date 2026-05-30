# RPP-0173 wp_term_relationships graph variant 4

Status: focused generated-harness regression proof added for variant 4.
Release remains NO-GO.

## Scenario

Variant 4 adds an explicit `wpTermRelationshipsGraphVariant4` target coverage
surface for deterministic `wp_terms` + `wp_term_taxonomy` +
`wp_term_relationships` graph changes. The variant-4 tag is emitted on the
existing relationship graph target cases so the generated summary exposes the
surface with per-tier counts and both ready and stale non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags relationship graph cases
  with `wp-term-relationships-graph-v4` plus ready, stale, and non-ready
  variant-4 tags and exposes
  `summary.targetCoverage.wpTermRelationshipsGraphVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0173 wp_term_relationships
  graph variant 4 retains ready apply and stale refusal regression coverage`.
- The focused test recounts all variant-4 target cases, cross-checks the
  summary total, per-tier counts, and statuses, and selects one ready case plus
  one stale non-ready case for invariant checks.
- The ready selected case proves the generated term, taxonomy, and relationship
  create mutations each carry matching preconditions, apply the local row hash,
  preserve the unplanned remote-only file, and reject stale replay with
  `PRECONDITION_FAILED` before mutation.
- The stale selected case proves the new relationship row remains blocked on
  the stale taxonomy reference, refuses apply with `PLAN_NOT_READY`, and leaves
  the remote digest unchanged.
- The generated model evidence stores only resource keys, term-id hashes,
  taxonomy/description hashes, relationship field hashes, blocker hashes,
  decision hashes, refusal hashes, and remote-only preservation hashes. It
  omits raw term names, slugs, taxonomy descriptions, stale taxonomy drift
  values, and remote-only file contents.

Deterministic target shape observed locally:

```json
{
  "wpTermRelationshipsGraphVariant4": {
    "family": "wp-term-relationships-graph-variant4",
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
    "wp-term-relationships-graph-v4": 10,
    "wp-term-relationships-graph-v4-ready": 5,
    "wp-term-relationships-graph-v4-stale": 5,
    "wp-term-relationships-graph-v4-non-ready": 5
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

Syntax checks:

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
```

Observed syntax result: both commands exited 0.

Focused command:

```sh
node --test --test-name-pattern=RPP-0173 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Required-family cross-check command:

```sh
node --test --test-name-pattern='generated push harness covers|RPP-0173' test/generated-push-harness.test.js
```

Observed cross-check result: 2 subtests, 0 failures.

Adjacent term-relationship generated-harness command:

```sh
node --test --test-name-pattern='RPP-0113|RPP-0133|RPP-0153|RPP-0173' test/generated-push-harness.test.js
```

Observed adjacent result: 3 subtests, 0 failures.

Full generated-harness command:

```sh
npm run test:generated-push-harness
```

Observed generated harness result: 80 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0173-wp-term-relationships-graph-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed hygiene result: checklist completion lint returned `"ok": true`,
the scoped redaction scan returned `"ok": true` with 0 rejected files, and both
diff whitespace checks reported no errors.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
