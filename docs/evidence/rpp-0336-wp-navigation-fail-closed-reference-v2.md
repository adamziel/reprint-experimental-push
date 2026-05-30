# RPP-0336 wp_navigation fail-closed reference v2 evidence

Date: 2026-05-30
Lane: RPP-0336 wp_navigation fail-closed reference, variant 2
Checklist item: RPP-0336 - Prove wp_navigation fail-closed reference, variant 2.

## Scope

This focused slice adds local planner/apply regression coverage for WordPress
`wp_navigation` post rows and dependent `wp_postmeta.post_id` references. It
adds only the RPP-0336 variant-2 test and this evidence note. It does not change
planner behavior, generated harnesses, release scripts, progress surfaces,
checklist state, or adjacent RPP-0316/RPP-0376/RPP-0396 artifacts.

## Evidence added

- `test/rpp-0336-wp-navigation-fail-closed-reference-v2.test.js` proves that an
  unmapped local `wp_posts` row with `post_type: "wp_navigation"` remains
  blocked as `stale-wordpress-graph-identity`. The planner emits no mutation
  for the navigation row or dependent metadata row, and `applyPlan()` refuses
  the blocked plan with `PLAN_NOT_READY` before mutation.
- The dependent metadata blocker carries hash-only target-support evidence for
  the `wp_postmeta.post_id` reference. The target support points at the
  unsupported `wp_navigation` surface and omits raw title, slug, content, GUID,
  and metadata payload values.
- The accepted path uses an explicit `wordpressGraphIdentityMap` from the local
  navigation source row to an equivalent remote navigation target row. The
  mapper records `map-local-identity-to-remote`, keeps the remote target
  stable, rewrites the dependent metadata row from the local `post_id` to the
  remote `post_id`, and applies only the rewritten metadata mutation with a
  live-remote precondition.

## Observed target shapes

Unmapped navigation reference:

```json
{
  "navigationResourceKey": "row:[\"wp_posts\",\"ID:336\"]",
  "navigationMetaResourceKey": "row:[\"wp_postmeta\",\"post_id:336:meta_key:rpp0336_navigation_owner\"]",
  "relationshipKey": "wp_postmeta.post_id",
  "relationshipType": "postmeta-post",
  "targetSupport": "stale-wordpress-graph-identity",
  "plannedNavigationMutation": false,
  "plannedMetadataMutation": false,
  "applyRefusal": "PLAN_NOT_READY",
  "remoteMutated": false,
  "evidenceFormat": "hash-only"
}
```

Explicit stable target mapping for the same navigation class:

```json
{
  "sourceNavigation": "row:[\"wp_posts\",\"ID:336\"]",
  "targetNavigation": "row:[\"wp_posts\",\"ID:1336\"]",
  "sourceDecision": "map-local-identity-to-remote",
  "targetDecision": "keep-remote",
  "postmetaRewrite": {
    "from": "row:[\"wp_postmeta\",\"post_id:336:meta_key:rpp0336_navigation_owner\"]",
    "to": "row:[\"wp_postmeta\",\"post_id:1336:meta_key:rpp0336_navigation_owner\"]",
    "field": "post_id",
    "plannedValue": 1336
  },
  "precondition": "live-remote"
}
```

The proof keeps unmapped `wp_navigation` movement fail-closed by default while
pinning the supported path: the mapper may carry the dependent metadata only
after the identity map proves an equivalent stable remote navigation target.

## Validation commands

```sh
node --check test/rpp-0336-wp-navigation-fail-closed-reference-v2.test.js
node --test test/rpp-0336-wp-navigation-fail-closed-reference-v2.test.js
node --test test/rpp-0316-wp-navigation-fail-closed-reference.test.js test/rpp-0336-wp-navigation-fail-closed-reference-v2.test.js test/rpp-0376-wp-navigation-fail-closed-reference-v4.test.js test/rpp-0396-wp-navigation-fail-closed-reference-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0336-wp-navigation-fail-closed-reference-v2.md
git diff --check
```

Observed local result after the update: syntax check passed; the focused
RPP-0336 test reported 2 subtests, 0 failures; the adjacent wp_navigation run
reported 9 subtests, 0 failures; artifact redaction scan for this evidence
returned `ok:true`; and whitespace diff check passed.

## Release posture

This lane is local planner/apply support evidence only. It is not live
production-backed release evidence and does not satisfy the broader final
release boundary. Release remains `NO-GO` until separate production evidence
satisfies the full release gate set.
