# RPP-0356 wp_navigation fail-closed reference v3 evidence

Date: 2026-05-31
Lane: RPP-0356 wp_navigation fail-closed reference, variant 3
Checklist item: RPP-0356 - Add generated coverage for wp_navigation fail-closed reference, variant 3.
Final release posture: `NO-GO`

## Scope

This is support-only local generated coverage for WordPress `wp_navigation`
post rows and dependent `wp_postmeta.post_id` references. It adds only the
focused RPP-0356 test and this evidence note. It does not change generated
harness sources, release scripts, progress surfaces, checklist files,
plugin-driver behavior, executor/auth, recovery, storage, or adjacent
`wp_navigation` variants.

## Proof surface

`test/rpp-0356-wp-navigation-fail-closed-reference-v3.test.js` builds
deterministic variant-3 fixtures for the `wp_navigation` graph surface.

The focused proof verifies:

- an unmapped local `wp_posts` row with `post_type: "wp_navigation"` remains
  blocked as `stale-wordpress-graph-identity`;
- the dependent `wp_postmeta.post_id` row inherits target-support evidence for
  the unsupported navigation row and is not planned;
- `applyPlan()` refuses the blocked plan with `PLAN_NOT_READY` before mutation,
  preserving the remote snapshot hash;
- with an explicit `wordpressGraphIdentityMap`, the mapper records
  `map-local-identity-to-remote`, preserves the remote navigation target as
  `keep-remote`, rewrites the dependent metadata row to the remote navigation
  ID, and applies only that rewritten metadata mutation; and
- support evidence is hash-only, with no raw navigation title, slug, block body,
  GUID, or metadata payload values.

## Hash-only evidence shape

```json
{
  "rpp": "RPP-0356",
  "evidenceSource": "wp-navigation-fail-closed-reference-v3",
  "status": "support_only",
  "releaseGate": "NO-GO",
  "productionBacked": false,
  "relationshipKey": "wp_postmeta.post_id",
  "coverage": {
    "blocked": 1,
    "ready": 1
  },
  "blocked": {
    "navigationResourceKey": "row:[\"wp_posts\",\"ID:356\"]",
    "navigationMetaResourceKey": "row:[\"wp_postmeta\",\"post_id:356:meta_key:rpp0356_navigation_owner\"]",
    "targetSupport": "stale-wordpress-graph-identity",
    "plannedNavigationMutation": false,
    "plannedMetadataMutation": false,
    "applyRefusal": "PLAN_NOT_READY",
    "remoteMutated": false
  },
  "mapped": {
    "sourceNavigation": "row:[\"wp_posts\",\"ID:356\"]",
    "targetNavigation": "row:[\"wp_posts\",\"ID:1356\"]",
    "sourceDecision": "map-local-identity-to-remote",
    "targetDecision": "keep-remote",
    "postmetaRewrite": {
      "from": "row:[\"wp_postmeta\",\"post_id:356:meta_key:rpp0356_navigation_owner\"]",
      "to": "row:[\"wp_postmeta\",\"post_id:1356:meta_key:rpp0356_navigation_owner\"]",
      "field": "post_id",
      "plannedValue": 1356
    },
    "precondition": "live-remote"
  }
}
```

The proof keeps unmapped `wp_navigation` movement fail-closed by default while
pinning the supported path: dependent metadata can move only when the identity
map proves an equivalent stable remote navigation target and the mapper rewrites
the reference.

## Validation commands

```sh
node --check test/rpp-0356-wp-navigation-fail-closed-reference-v3.test.js
node --test --test-name-pattern RPP-0356 test/rpp-0356-wp-navigation-fail-closed-reference-v3.test.js
node --test --test-name-pattern RPP-0376 test/rpp-0376-wp-navigation-fail-closed-reference-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0356-wp-navigation-fail-closed-reference-v3.md
git diff --check
git diff --cached --check
```

Observed local result after implementation: syntax check passed; the focused
RPP-0356 run reported 3 subtests with 0 failures; the adjacent RPP-0376 run
reported 2 subtests with 0 failures; artifact redaction scan returned
`"ok": true`; and staged plus unstaged whitespace checks passed.

## Release posture

This is local generated support evidence only. It is not production-backed
release evidence and does not satisfy the broader final release boundary. Final
release remains `NO-GO`.
