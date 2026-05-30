# RPP-0170 wp_comments and wp_commentmeta graph variant 4

Status: focused generated-harness regression proof added for variant 4.
Release remains NO-GO.

## Scenario

Variant 4 adds an explicit `wpCommentsCommentmetaGraphVariant4` target coverage
surface for generated `wp_comments` rows and their `wp_commentmeta.comment_id`
references. The variant-4 tag is emitted on both the ready graph family and the
stale remote-drift family so the generated summary exposes the target with
per-tier counts and both ready and non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags comment/commentmeta graph
  cases with `wp-comments-commentmeta-graph-v4` plus ready, stale, and
  non-ready variant-4 tags and exposes
  `summary.targetCoverage.wpCommentsCommentmetaGraphVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0170 wp_comments and
  wp_commentmeta graph variant 4 records surface and invariant`.
- The focused test recounts all variant-4 target cases, cross-checks the
  summary total, per-tier counts, and statuses, and selects one ready case plus
  one stale non-ready case for invariant checks.
- The ready selected case proves the generated comment and commentmeta create
  mutations each carry matching preconditions, apply the local row hash,
  preserve unplanned remote data, and reject stale replay with
  `PRECONDITION_FAILED` before mutation.
- The stale selected case proves remote drift on the referenced `wp_comments`
  row blocks the new `wp_commentmeta` row through
  `stale-wordpress-graph-identity`, refuses apply with `PLAN_NOT_READY`, and
  leaves the remote digest unchanged.
- The generated model evidence stores only resource keys, row-id hashes,
  meta-key hashes, row hashes, blocker hashes, decision hashes, and refusal
  hashes. It omits raw comment content, commentmeta keys, and commentmeta
  values.

Deterministic target shape observed locally:

```json
{
  "wpCommentsCommentmetaGraphVariant4": {
    "family": "wp-comments-commentmeta-graph-variant4",
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
      "blocked": 10,
      "ready": 10
    }
  },
  "featureFamilies": {
    "wp-comments-commentmeta-graph-v4": 20,
    "wp-comments-commentmeta-graph-v4-ready": 10,
    "wp-comments-commentmeta-graph-v4-stale": 10,
    "wp-comments-commentmeta-graph-v4-non-ready": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready comment/commentmeta graph case and one stale non-ready comment/commentmeta graph case",
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
node --test --test-name-pattern=RPP-0170 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Adjacent comments/commentmeta generated-harness command:

```sh
node --test --test-name-pattern='RPP-0110|RPP-0130|RPP-0150|RPP-0170' test/generated-push-harness.test.js
```

Observed adjacent result: 3 subtests, 0 failures.

Full generated-harness command:

```sh
npm run test:generated-push-harness
```

Observed generated harness result: 77 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0170-wp-comments-commentmeta-graph-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed hygiene result: checklist completion lint returned `"ok": true`,
the scoped redaction scan returned `"ok": true` with 0 rejected files, and both
diff whitespace checks reported no errors.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
