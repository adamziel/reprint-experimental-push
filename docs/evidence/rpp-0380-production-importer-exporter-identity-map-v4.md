# RPP-0380 production importer/exporter identity-map regression evidence

Date: 2026-05-30
Lane: RPP-0380 production importer/exporter identity map, variant 4
Checklist item: RPP-0380 — Add focused regression coverage for production importer/exporter identity map, variant 4.

## Scope

This slice adds a focused local regression for production-shaped
importer/exporter identity-map metadata. It does not touch generated harness
files, public progress surfaces, release verifier plumbing, recovery/storage,
plugin-driver behavior, topology, or adjacent RPP-0379/RPP-0381 files.

## Evidence added

- `test/rpp-0380-production-importer-exporter-identity-map-v4.test.js` builds a
  minimal source/local/imported-remote graph where the base snapshot carries
  production-style `meta.pushIdentityMap` provenance from exporter and importer
  observations.
- The ready case proves that the planner accepts the `pushIdentityMap` alias,
  records `map-local-identity-to-remote` for the exported source parent row,
  preserves the imported remote target as `keep-remote`, and creates no mutation
  for the exported source identity row.
- Dependent rows are rewritten through the imported target: the child page
  `wp_posts.post_parent` points at the imported remote ID, and the
  `wp_postmeta.post_id` mutation moves from the source post resource key to the
  imported target postmeta resource key with live-remote preconditions.
- The stale case mutates the imported target row before planning. The identity
  map becomes unusable because the remote target is no longer equivalent after
  identity rewriting, so source, child, and postmeta rows stop as
  `stale-wordpress-graph-identity` blockers.
- Blocked stale-target evidence remains hash-only: blocker and reference
  evidence carry resource keys, relationship metadata, states, and hashes while
  omitting the private parent title, child title, post bodies, and metadata
  payload.

## Observed target shapes

Ready production importer/exporter map:

```json
{
  "mapAlias": "pushIdentityMap",
  "mapSource": "base-snapshot.meta.identityMap[2].resources[0]",
  "sourceDecision": "map-local-identity-to-remote",
  "targetDecision": "keep-remote",
  "sourceMutated": false,
  "dependentRewrites": [
    "wp_posts.post_parent",
    "wp_postmeta.post_id"
  ],
  "liveRemotePreconditions": true
}
```

Stale imported target:

```json
{
  "status": "blocked",
  "class": "stale-wordpress-graph-identity",
  "reason": "remote target row is not equivalent after identity rewriting",
  "mutations": 0,
  "applyRefusal": "PLAN_NOT_READY",
  "remoteMutated": false,
  "rawValuesIncluded": false
}
```

## Current unmapped WordPress surfaces

RPP-0380 keeps importer/exporter identity maps bounded to explicit
`pushIdentityMap` entries whose remote target rows are present and equivalent
after scalar identity rewriting. Stale, ambiguous, missing, or non-equivalent
imported targets remain unmapped and fail closed as
`stale-wordpress-graph-identity` blockers.

The remaining WordPress surfaces that still require a future owner/driver,
parser-aware mapper, or explicit equivalent remote identity proof are:

- `wp_posts.post_type = nav_menu_item`, `revision`, and unmapped
  `wp_navigation` rows.
- Menu item graph metadata such as `_menu_item_object`,
  `_menu_item_object_id`, `_menu_item_menu_item_parent`, `_menu_item_type`, and
  `menu_item_parent`.
- `wp_term_taxonomy.taxonomy = nav_menu` rows and dependent nav-menu
  `wp_term_relationships` rows.
- Custom/plugin taxonomy rows that do not have an explicit, equivalent remote
  identity-map target.
- Serialized block references in post content or excerpts that require
  parser-aware graph identity mapping instead of scalar ID rewriting.
- Any importer/exporter map entry for a table outside the supported WordPress
  graph identity-map surfaces, or whose imported target row is stale, absent, or
  ambiguous.

## Validation commands

```sh
node --check test/rpp-0380-production-importer-exporter-identity-map-v4.test.js
node --test test/rpp-0380-production-importer-exporter-identity-map-v4.test.js
node --test --test-name-pattern='production importer exporter identity maps|RPP-0380' test/rpp-0380-production-importer-exporter-identity-map-v4.test.js test/local-production-complex-site-proof.test.js
node --test test/graph-mapping-inventory.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0380-production-importer-exporter-identity-map-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed local result for the new focused RPP-0380 command: 2 subtests, 0
failures. Release remains held for broader graph-identity and production
evidence gates outside this focused importer/exporter identity-map regression
slice.
