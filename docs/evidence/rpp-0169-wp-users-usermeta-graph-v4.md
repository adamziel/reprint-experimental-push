# RPP-0169 wp_users and wp_usermeta graph variant 4

Date: 2026-05-30
Lane: RPP-0169 wp_users/wp_usermeta graph, variant 4
Checklist item: RPP-0169 - Add focused regression coverage for wp_users and
wp_usermeta graph changes, variant 4.

## Scope

This is local generated-harness regression evidence for deterministic
`wp_users` and `wp_usermeta` graph behavior. It does not change production
release posture or replace release-gate validation.

## Proof surface

- `scripts/harness/generated-push-cases.js` now emits
  `wp-users-usermeta-graph-v4` on the existing ready and stale user/usermeta
  graph families, with ready, stale, and non-ready variant-4 sub-tags.
- `summary.targetCoverage.wpUsersUsermetaGraphVariant4` reports 20 target
  cases: 10 ready user/usermeta graph cases and 10 stale non-ready graph cases,
  with two cases in each tier from 0 through 9.
- `test/generated-push-harness.test.js` adds `RPP-0169 wp_users/wp_usermeta
  graph variant 4 rejects stale replay before mutation`.
- The focused proof selects one ready graph case and one stale non-ready graph
  case, then records only resource keys, planner summaries, user-id hashes,
  meta-key hashes, graph mutation hashes, blocker hashes, decision hashes,
  refusal hashes, and model proof hashes.
- The ready case proves the generated user and usermeta rows apply together,
  unplanned remote data is preserved, and stale remote replay raises
  `PRECONDITION_FAILED` before mutation.
- The stale case proves the drifted user target produces a
  `stale-wordpress-graph-identity` blocker, `applyPlan()` refuses the plan with
  `PLAN_NOT_READY`, and the remote digest is unchanged.

Deterministic target shape observed locally:

```json
{
  "wpUsersUsermetaGraphVariant4": {
    "family": "wp-users-usermeta-graph-variant4",
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
    "wp-users-usermeta-graph-v4": 20,
    "wp-users-usermeta-graph-v4-ready": 10,
    "wp-users-usermeta-graph-v4-stale": 10,
    "wp-users-usermeta-graph-v4-non-ready": 10
  },
  "selectedModelEvidence": {
    "selectedCases": 2,
    "selection": "one ready user/usermeta graph case and one stale non-ready graph case",
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
node --test --test-name-pattern=RPP-0169 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0109|RPP-0129|RPP-0149|RPP-0169' test/generated-push-harness.test.js
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0169-wp-users-usermeta-graph-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed generated-harness results:

- Syntax checks exited 0 for both generated harness source files.
- Focused RPP-0169 reported 1 subtest, 0 failures.
- Adjacent user/usermeta generated-harness slice reported 3 subtests, 0
  failures.
- `npm run test:generated-push-harness` reported 76 subtests, 0 failures.
- Checklist completion lint returned `"ok": true` with 0 risky claims.
- Scoped artifact redaction scan returned `"ok": true` with no rejected files.
- `git diff --check` and `git diff --cached --check` reported no whitespace
  errors.

Release caveat: this remains deterministic local generated-model evidence. It
does not replace integration-lane, release-gate, or production-backed
validation.
