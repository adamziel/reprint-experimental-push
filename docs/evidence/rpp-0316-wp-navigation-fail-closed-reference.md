# RPP-0316 wp_navigation fail-closed reference evidence

Date: 2026-05-29
Lane: RPP-0316 wp_navigation fail-closed reference, variant 1
Checklist item: RPP-0316 — Implement wp_navigation fail-closed reference, variant 1.

## Scope

This slice stays inside focused graph-identity proof for WordPress
`wp_navigation` post rows and dependent post metadata references. It does not
touch public progress pages, generated-harness targets, merge-invariant logic,
plugin-driver behavior, executor-auth routes, recovery/storage, topology, or
release-ops code.

## Evidence added

- `test/rpp-0316-wp-navigation-fail-closed-reference.test.js` proves that a
  local `wp_posts` row with `post_type: "wp_navigation"` fails closed as
  `stale-wordpress-graph-identity` when no explicit identity map proves the
  remote target. The planner does not create a mutation for the navigation row.
- The same fail-closed case includes a dependent `wp_postmeta.post_id`
  reference to the local navigation row. That dependent row is blocked instead
  of planned because its target support is the unsupported `wp_navigation`
  graph surface.
- The mapper path is covered with an explicit WordPress graph identity map from
  the local `wp_navigation` source row to an equivalent remote target row. The
  planner records `map-local-identity-to-remote` for the source, preserves the
  target as `keep-remote`, rewrites the dependent `wp_postmeta.post_id` from the
  local ID to the remote ID, and applies only the rewritten metadata row with a
  live-remote precondition.
- Unsupported evidence remains hash-only: blocker and target-reference evidence
  retain SHA-256 hashes, resource keys, relationship metadata, and target-support
  class/reason while omitting raw private navigation title, slug, block body,
  GUID, and metadata payload values.

## Observed target shapes

Unsupported `wp_navigation` row without an identity map:

```json
{
  "resourceKey": "row:[\"wp_posts\",\"ID:316\"]",
  "class": "stale-wordpress-graph-identity",
  "reason": "unsupported post graph surface wp_navigation",
  "resolutionPolicy": "preserve-remote-wordpress-graph-and-stop",
  "plannedMutation": false
}
```

Dependent metadata reference to the unsupported navigation row:

```json
{
  "resourceKey": "row:[\"wp_postmeta\",\"post_id:316:meta_key:rpp0316_navigation_owner\"]",
  "relationshipKey": "wp_postmeta.post_id",
  "relationshipType": "postmeta-post",
  "targetResourceKey": "row:[\"wp_posts\",\"ID:316\"]",
  "targetSupport": "stale-wordpress-graph-identity",
  "applyRefusal": "PLAN_NOT_READY",
  "remoteMutated": false
}
```

Explicit identity-map proof for the same navigation class:

```json
{
  "sourceNavigation": "row:[\"wp_posts\",\"ID:316\"]",
  "targetNavigation": "row:[\"wp_posts\",\"ID:1316\"]",
  "sourceDecision": "map-local-identity-to-remote",
  "targetDecision": "keep-remote",
  "postmetaRewrite": {
    "from": "row:[\"wp_postmeta\",\"post_id:316:meta_key:rpp0316_navigation_owner\"]",
    "to": "row:[\"wp_postmeta\",\"post_id:1316:meta_key:rpp0316_navigation_owner\"]",
    "field": "post_id",
    "plannedValue": 1316
  },
  "precondition": "live-remote"
}
```

The focused proof therefore keeps unmapped `wp_navigation` movement fail-closed
by default while still allowing a dependent reference to move only when an
explicit identity map proves stable remote identity for the target.

## Validation commands

```sh
node --test test/rpp-0316-wp-navigation-fail-closed-reference.test.js
node --test --test-name-pattern='RPP-0316|wp_navigation' test/rpp-0316-wp-navigation-fail-closed-reference.test.js test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0316-wp-navigation-fail-closed-reference.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed local result for the focused RPP-0316 command: 2 subtests, 0 failures.
The broader `RPP-0316|wp_navigation` graph command, checklist completion lint,
touched-doc artifact redaction scan, and whitespace diff check were run locally
after this file and the checklist line were updated; all returned exit code 0.

Release remains held for broader graph-identity and production evidence gates
outside this focused `wp_navigation` fail-closed reference slice.
