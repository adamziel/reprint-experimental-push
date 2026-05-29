# RPP-0303 post author reference evidence

Date: 2026-05-29
Lane: RPP-0303 post author reference, variant 1
Checklist item: RPP-0303 — Implement post author reference, variant 1.

## Scope

This slice strengthens generated graph-identity evidence for
`wp_posts.post_author` references to `wp_users` rows. It stays within the local
generated harness and graph-reference planner model; it does not update public
progress surfaces.

## Evidence added

- `scripts/harness/generated-push-cases.js` now exposes a `postAuthorGraph`
  target coverage bucket over the existing post-author graph tag.
- The generated stale post-author case now models a true stale target: the user
  exists in base/local, drifts remotely, and the local authored post points at
  that user.
- `test/generated-push-harness.test.js` adds a focused RPP-0303 generated
  harness assertion over all target cases.

## Observed target shape

Hash-only summary from `node scripts/harness/generated-push-cases.js`:

```json
{
  "postAuthorGraph": {
    "family": "same-plan-post-author-graph",
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
  }
}
```

The focused test verifies that every ready case creates the user and authored
post in one plan, applies the authored post with the generated `post_author`
value, preserves unplanned remote resources, and rejects stale replay before
mutation. It also verifies that every stale case blocks the authored post,
emits `wp_posts.post_author` reference evidence to the user target, records only
hashes for target state, and does not serialize generated private target values.

## Validation commands

```sh
node --test --test-name-pattern=RPP-0303 test/generated-push-harness.test.js
node --test --test-name-pattern 'post author|post_author|post-author' test/push-planner.test.js
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0303-post-author-reference.md docs/evidence/ao-graph-identity.md docs/generated-push-harness.md
git diff --check
```

Observed local result for the focused RPP-0303 command: 1 subtest, 0 failures.
Observed local result for the focused planner command: 1 subtest, 0 failures.
Observed local result for the full generated harness command: 42 subtests,
0 failures.

Release remains held for the broader graph-identity and production evidence
gates outside this local generated-harness slice.
