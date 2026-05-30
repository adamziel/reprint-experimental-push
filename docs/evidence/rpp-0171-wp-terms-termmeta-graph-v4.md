# RPP-0171 wp_terms/wp_termmeta graph variant 4

Status: focused generated-harness proof added for variant 4. Release remains
NO-GO.

## Scenario

Variant 4 adds an explicit `wpTermsTermmetaGraphVariant4` target coverage
surface for deterministic `wp_terms` + `wp_termmeta` graph changes. The
variant-4 tag is emitted on both the ready term/termmeta graph family and the
stale remote-drift family so the generated summary exposes the target with
per-tier counts and both ready and non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags terms/termmeta graph cases
  with `wp-terms-termmeta-graph-v4` plus ready/stale/non-ready variant-4 tags
  and exposes `summary.targetCoverage.wpTermsTermmetaGraphVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0171 wp_terms/wp_termmeta
  graph variant 4 keeps ready and stale graph regression coverage focused`.
- The focused test recounts all variant-4 target cases, cross-checks summary
  total, per-tier counts, and statuses, and selects one ready case plus one
  stale non-ready case for invariant checks.
- The ready selected case proves the generated term and termmeta creates each
  carry matching preconditions, apply the local hashes, preserve unplanned
  remote data, and reject stale replay with `PRECONDITION_FAILED` before
  mutation.
- The stale selected case proves the new termmeta row remains blocked on the
  stale term reference, refuses apply with `PLAN_NOT_READY`, and leaves the
  remote digest unchanged.
- The generated model evidence stores only resource keys, term-id hashes,
  term-slug hashes, meta-key hashes, counts, blocker hashes, and refusal hashes.
  It omits raw term names, slugs, and termmeta values.

Deterministic target shape observed locally:

```json
{
  "wpTermsTermmetaGraphVariant4": {
    "family": "wp-terms-termmeta-graph-variant4",
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
      "blocked": 3,
      "conflict": 7,
      "ready": 10
    }
  },
  "featureFamilies": {
    "wp-terms-termmeta-graph-v4": 20,
    "wp-terms-termmeta-graph-v4-ready": 10,
    "wp-terms-termmeta-graph-v4-stale": 10,
    "wp-terms-termmeta-graph-v4-non-ready": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready terms/termmeta graph case and one stale non-ready terms/termmeta graph case",
    "evidenceScope": "local-generated-model",
    "productionBacked": false,
    "releaseGate": "NO-GO"
  }
}
```

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0171 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0111|RPP-0131|RPP-0151|RPP-0171' test/generated-push-harness.test.js
node --test --test-name-pattern='generated push harness covers|RPP-0151|RPP-0171' test/generated-push-harness.test.js
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0171-wp-terms-termmeta-graph-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0171 slice reported 1
subtest, 0 failures; the adjacent terms/termmeta slice reported 3 subtests, 0
failures; the generated-family cross-check reported 3 subtests, 0 failures; and
the full generated-push harness reported 78 subtests, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
