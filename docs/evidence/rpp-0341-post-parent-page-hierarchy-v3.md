# RPP-0341 post_parent page hierarchy generated evidence, variant 3

Date: 2026-05-31
Lane: RPP-0341 post_parent page hierarchy generated coverage, variant 3
Checklist item: RPP-0341 - Add generated coverage for post_parent page hierarchy, variant 3.

## Scope

This slice adds deterministic local generated-harness evidence for WordPress page
hierarchy references stored in `wp_posts.post_parent`. It does not change
production planner behavior, release verifier code, shared progress surfaces, or
release status. Final release remains `NO-GO`.

## Evidence added

- `scripts/harness/generated-push-cases.js` adds the
  `postParentPageHierarchyVariant3` target without changing the 620-case roster
  or 62 scenario-family distribution.
- The target tags 20 generated cases across all 10 tiers: 10 ready identity-map
  rewrite cases and 10 stale parent drift cases.
- Ready cases map a local parent page row to an equivalent remote parent page row
  via `meta.wordpressGraphIdentityMap`, preserve the remote parent, and rewrite
  the child page `post_parent` to the proven remote ID.
- Stale cases keep the parent page in base/local, drift it remotely, and require
  the child page reference to fail closed as `stale-wordpress-graph-identity`
  before apply.
- `test/generated-push-harness.test.js` recounts the target coverage, proves the
  ready identity-map decisions and rewrite metadata, verifies stale apply refusal
  leaves the remote digest unchanged, and asserts generated evidence stays
  hash-only without raw page titles, slugs, or bodies.

## Observed target shape

```json
{
  "target": "postParentPageHierarchyVariant3",
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
  "readyRelationship": "wp_posts.post_parent",
  "readySourceDecision": "map-local-identity-to-remote",
  "readyTargetDecision": "keep-remote",
  "staleRefusal": "PLAN_NOT_READY"
}
```

The focused generated proof serializes resource keys, IDs, relationship names,
status counts, decision names, and SHA-256 hashes only. Raw generated page
titles, slugs, and bodies are intentionally excluded from the evidence envelope.

## Validation commands

```sh
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0341 test/generated-push-harness.test.js
node --test --test-name-pattern='RPP-0303|RPP-0341|RPP-0347|RPP-0342' test/generated-push-harness.test.js
node --test --test-name-pattern='post parent|post_parent|post-parent|RPP-0361|RPP-0381' test/push-planner.test.js test/rpp-0361-post-parent-page-hierarchy-v4.test.js test/rpp-0381-post-parent-page-hierarchy-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/generated-push-harness.md docs/evidence/rpp-0341-post-parent-page-hierarchy-v3.md
git diff --check
```

Observed local result during implementation: syntax checks exited 0, the
focused RPP-0341 generated-harness command passed 1 subtest with 0 failures, the
adjacent generated graph command passed 4 subtests with 0 failures, the adjacent
post_parent planner/release lineage command passed 8 subtests with 0 failures,
and the artifact redaction scan accepted this evidence note plus
`docs/generated-push-harness.md`.
