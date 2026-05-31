# RPP-0344 postmeta post_id reference generated evidence, variant 3

Date: 2026-05-31
Lane: RPP-0344 postmeta post_id reference generated coverage, variant 3
Checklist item: RPP-0344 - Add generated coverage for postmeta post_id reference, variant 3.

## Scope

This slice adds deterministic local generated-harness evidence for WordPress
postmeta rows that reference posts through `wp_postmeta.post_id`. It does not
change production release status, production verifier code, or any shared
release posture. Final release remains `NO-GO`.

## Evidence added

- `scripts/harness/generated-push-cases.js` adds the
  `postmetaPostIdReferenceVariant3` target without changing the 620-case roster
  or 62 scenario-family distribution.
- The target tags 20 generated support-only cases across all 10 tiers: 10 ready
  post identity-map rewrite cases and 10 stale post drift cases.
- Ready cases map a local `wp_posts` source row to an equivalent remote
  `wp_posts` row through `meta.wordpressGraphIdentityMap`, preserve the remote
  post, and rewrite the dependent `wp_postmeta` row key plus row `post_id` to
  the proven remote ID.
- Stale cases keep the target post in base/local, drift it remotely, and require
  the dependent postmeta row to fail closed as `stale-wordpress-graph-identity`
  before apply.
- `test/generated-push-harness.test.js` recounts the target coverage, proves the
  ready identity-map decisions and rewrite metadata, verifies stale apply
  refusal leaves the remote digest unchanged, and asserts generated evidence
  stays hash-only without raw generated post titles, slugs, bodies, or postmeta
  payloads.

## Observed target shape

```json
{
  "target": "postmetaPostIdReferenceVariant3",
  "totalCases": 20,
  "statuses": {
    "blocked": 10,
    "ready": 10
  },
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
  "readyRelationship": "wp_postmeta.post_id",
  "readySourceDecision": "map-local-identity-to-remote",
  "readyTargetDecision": "keep-remote",
  "staleRefusal": "PLAN_NOT_READY"
}
```

The focused generated proof serializes resource keys, IDs, relationship names,
status counts, decision names, refusal codes, and SHA-256 hashes only. Raw
generated post and postmeta payloads are intentionally excluded from the
evidence envelope.

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0344 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0341|RPP-0343|RPP-0344' test/generated-push-harness.test.js
node --test --test-name-pattern='postmeta references|postmeta when its WordPress post identity|WordPress graph identity map references|RPP-0364|RPP-0384' test/push-planner.test.js test/rpp-0364-postmeta-post-id-reference-v4.test.js test/rpp-0384-postmeta-post-id-reference-release-verifier-v5.test.js
npm run test:generated-push-harness
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0344-postmeta-post-id-reference-v3.md
git diff --check
git diff --cached --check
```

Observed local result during implementation: syntax checks exited 0, the
focused RPP-0344 generated-harness command passed 1 test file with 0 failures,
the adjacent RPP-0341/RPP-0343/RPP-0344 generated graph command passed 1 test
file with 0 failures, the adjacent postmeta lineage command passed 3 test files
with 0 failures, and the full generated harness passed 1 test file with 0
failures. The artifact redaction scan and diff checks are recorded as final
validation for this evidence note and `docs/generated-push-harness.md`.
