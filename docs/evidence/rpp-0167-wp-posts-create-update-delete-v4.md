# RPP-0167 wp_posts create/update/delete variant 4

Status: focused generated-harness proof added for variant 4. Release remains
NO-GO.

## Scenario

Variant 4 adds an explicit `wpPostsCreateUpdateDeleteVariant4` target coverage
surface for deterministic, regular `wp_posts` create/update/delete changes. The
variant-4 tag is emitted on both the ready post create/update/delete family and
the conflicting remote-drift family so the generated summary exposes the target
with per-tier counts and both ready and non-ready statuses.

## Evidence surface

- `scripts/harness/generated-push-cases.js` now tags `wp_posts`
  create/update/delete cases with `wp-posts-create-update-delete-v4` plus
  ready/non-ready variant-4 tags and exposes
  `summary.targetCoverage.wpPostsCreateUpdateDeleteVariant4`.
- `test/generated-push-harness.test.js` adds `RPP-0167 wp_posts
  create/update/delete variant 4 exposes per-tier generated coverage`.
- The focused test recounts all variant-4 target cases, cross-checks the
  summary total, per-tier counts, and statuses, and selects one ready case plus
  one non-ready conflict case for invariant checks.
- The ready selected case proves the generated post create, update, and delete
  mutations each carry matching preconditions, apply the local `wp_posts` hash,
  preserve unplanned remote data, and reject stale replay with
  `PRECONDITION_FAILED` before mutation.
- The non-ready selected case proves remote drift on the updated `wp_posts` row
  remains a conflict, refuses apply with `PLAN_NOT_READY`, and leaves the remote
  digest unchanged.
- The generated model evidence stores only resource keys, post types, counts,
  hashes, conflict hashes, and refusal hashes. It omits raw post titles and post
  content payloads.

Deterministic target shape observed locally:

```json
{
  "wpPostsCreateUpdateDeleteVariant4": {
    "family": "wp-posts-create-update-delete-variant4",
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
  "featureFamilies": {
    "wp-posts-create-update-delete-v4": 20,
    "wp-posts-create-update-delete-v4-ready": 10,
    "wp-posts-create-update-delete-v4-non-ready": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready wp_posts create/update/delete case and one non-ready wp_posts conflict case",
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
node --test --test-name-pattern=RPP-0167 test/generated-push-harness.test.js
```

Observed focused result: 1 subtest, 0 failures.

Adjacent wp_posts generated-harness command:

```sh
node --test --test-name-pattern='RPP-0107|RPP-0127|RPP-0147|RPP-0167' test/generated-push-harness.test.js
```

Observed adjacent result: 3 subtests, 0 failures.

Full generated-harness command:

```sh
npm run test:generated-push-harness
```

Observed generated harness result: 74 subtests, 0 failures.

Repository hygiene commands:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0167-wp-posts-create-update-delete-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed hygiene result: checklist completion lint returned `"ok": true`,
the scoped redaction scan returned `"ok": true` with 0 rejected files, and both
diff whitespace checks reported no errors.

Release caveat: this is deterministic local generated-harness evidence. It does
not replace release-gate, integration-lane, or production-backed validation.
