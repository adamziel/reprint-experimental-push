# RPP-0376 wp_navigation fail-closed reference, variant 4

Date: 2026-05-30
Lane: RPP-0376 wp_navigation fail-closed reference, variant 4
Checklist item: RPP-0376 — Add focused regression coverage for wp_navigation fail-closed reference, variant 4.

## Scope

This slice adds local planner/apply regression coverage for WordPress
`wp_navigation` rows and dependent `wp_postmeta.post_id` references only. It does
not touch generated harness files, release surfaces, public progress artifacts,
plugin-driver behavior, recovery/storage, or unrelated graph targets.

## Evidence added

- `test/rpp-0376-wp-navigation-fail-closed-reference-v4.test.js` proves an
  unmapped local `wp_posts` row with `post_type: "wp_navigation"` stops as
  `stale-wordpress-graph-identity`, emits no navigation-row mutation, and causes
  the dependent `wp_postmeta.post_id` row to inherit hash-only target-support
  evidence instead of being planned.
- The blocked plan rejects during apply with `PLAN_NOT_READY` and preserves the
  remote snapshot hash before any mutation.
- The same focused file proves the accepted path: an explicit
  `wordpressGraphIdentityMap` from the local navigation row to a remote
  navigation row records `map-local-identity-to-remote`, keeps the remote target
  stable, rewrites the dependent metadata resource key and `post_id`, and applies
  only the rewritten metadata mutation with a live-remote precondition.

## Observed target shapes

Unmapped navigation target:

```json
{
  "resourceKey": "row:[\"wp_posts\",\"ID:376\"]",
  "class": "stale-wordpress-graph-identity",
  "reason": "unsupported post graph surface wp_navigation",
  "plannedMutation": false,
  "applyRefusal": "PLAN_NOT_READY",
  "remoteMutated": false
}
```

Mapped dependent reference:

```json
{
  "sourceNavigation": "row:[\"wp_posts\",\"ID:376\"]",
  "targetNavigation": "row:[\"wp_posts\",\"ID:1376\"]",
  "sourceDecision": "map-local-identity-to-remote",
  "targetDecision": "keep-remote",
  "postmetaRewrite": {
    "from": "row:[\"wp_postmeta\",\"post_id:376:meta_key:rpp0376_navigation_owner\"]",
    "to": "row:[\"wp_postmeta\",\"post_id:1376:meta_key:rpp0376_navigation_owner\"]",
    "field": "post_id",
    "plannedValue": 1376
  },
  "precondition": "live-remote"
}
```

## Validation commands

```sh
node --check test/rpp-0376-wp-navigation-fail-closed-reference-v4.test.js
node --test test/rpp-0376-wp-navigation-fail-closed-reference-v4.test.js
node --test --test-name-pattern='RPP-0316|RPP-0376|wp_navigation' test/rpp-0316-wp-navigation-fail-closed-reference.test.js test/rpp-0376-wp-navigation-fail-closed-reference-v4.test.js test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0376-wp-navigation-fail-closed-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed local results after this file and the checklist line were updated:
focused RPP-0376 syntax/test validation returned exit code 0 with 2 subtests;
the adjacent wp_navigation graph-identity command returned exit code 0 with 5
subtests; checklist lint, touched-doc artifact redaction, and whitespace checks
returned exit code 0.

Release remains held for broader graph-identity and production evidence gates
outside this focused RPP-0376 regression slice.
