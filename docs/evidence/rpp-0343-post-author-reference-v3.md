# RPP-0343 post author reference generated evidence, variant 3

Date: 2026-05-31
Lane: RPP-0343 post author reference generated coverage, variant 3
Checklist item: RPP-0343 - Add generated coverage for post author reference, variant 3.

## Scope

This slice adds deterministic local generated-harness evidence for WordPress
authored post references stored in `wp_posts.post_author`. It does not change
production planner behavior, release verifier code, shared progress surfaces, or
release status. Final release remains `NO-GO`.

## Evidence added

- `scripts/harness/generated-push-cases.js` adds the
  `postAuthorGraphVariant3` target without changing the 620-case roster or 62
  scenario-family distribution.
- The target tags 20 generated support-only cases across all 10 tiers: 10 ready
  author identity-map rewrite cases and 10 stale author drift cases.
- Ready cases map a local `wp_users` author row to an equivalent remote
  `wp_users` row via `meta.wordpressGraphIdentityMap`, preserve the remote
  author, and rewrite the authored post `post_author` to the proven remote ID.
- Stale cases keep the author in base/local, drift it remotely, and require the
  authored post reference to fail closed as `stale-wordpress-graph-identity`
  before apply.
- `test/generated-push-harness.test.js` recounts the target coverage, proves the
  ready identity-map decisions and rewrite metadata, verifies stale apply
  refusal leaves the remote digest unchanged, and asserts generated evidence
  stays hash-only without raw post titles, slugs, bodies, user logins, emails, or
  display names.

## Observed target shape

```json
{
  "target": "postAuthorGraphVariant3",
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
  "readyRelationship": "wp_posts.post_author",
  "readySourceDecision": "map-local-identity-to-remote",
  "readyTargetDecision": "keep-remote",
  "staleRefusal": "PLAN_NOT_READY"
}
```

The focused generated proof serializes resource keys, IDs, relationship names,
status counts, decision names, and SHA-256 hashes only. Raw generated post/user
payloads are intentionally excluded from the evidence envelope.

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0343 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0303|RPP-0343' test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0323|RPP-0363|RPP-0383' test/rpp-0323-post-author-reference-v2.test.js test/rpp-0363-post-author-reference-v4.test.js test/rpp-0383-post-author-reference-release-verifier-v5.test.js
node --test --test-name-pattern='post author|post_author|post-author' test/push-planner.test.js
npm run test:generated-push-harness
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0343-post-author-reference-v3.md
git diff --check
```

Observed local result during implementation: syntax checks exited 0, the
focused RPP-0343 generated-harness command passed 1 subtest with 0 failures, the
adjacent RPP-0303/RPP-0343 generated-harness command passed 2 subtests with 0
failures, the adjacent RPP-0323/RPP-0363/RPP-0383 post-author lineage command
passed 6 subtests with 0 failures, the adjacent post-author planner command
passed 1 subtest with 0 failures, and the full generated harness passed 96
subtests with 0 failures. The artifact redaction scan and `git diff --check`
are recorded as final validation for this evidence note and
`docs/generated-push-harness.md`.
