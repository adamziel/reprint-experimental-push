# RPP-0360 production importer/exporter identity-map variant 3 evidence

Date: 2026-05-31
Lane: RPP-0360 production importer/exporter identity map, variant 3
Checklist item: RPP-0360 - Add generated coverage for production importer/exporter identity map, variant 3.
Success text: docs state remaining unmapped WordPress surfaces.
Final release posture: `NO-GO`

## Scope

This is support-only local generated coverage for production-shaped
importer/exporter `pushIdentityMap` metadata. It adds only the focused RPP-0360
test and this evidence note. It does not edit generated harness sources,
release verifier code, shared progress surfaces, checklist files, or production
release status.

## Proof surface

- `test/rpp-0360-production-importer-exporter-identity-map-v3.test.js`
  generates 20 deterministic importer/exporter identity-map cases: one ready
  imported-target case and one stale imported-target case for each tier 0
  through 9.
- Every base snapshot carries production-shaped `meta.pushIdentityMap`
  provenance with hash-only exporter and importer package identifiers and
  `immutableBase: true`.
- Ready cases map the exported local source parent row to the imported remote
  target row, preserve the imported remote target as `keep-remote`, and create
  no mutation for the exported source identity row.
- Dependent rows are rewritten through the imported target: the child
  `wp_posts.post_parent` points at the imported remote ID, and the
  `wp_postmeta.post_id` mutation moves from the source post resource key to the
  imported target postmeta resource key with live-remote preconditions.
- Stale imported-target cases block before mutation as
  `stale-wordpress-graph-identity` when the imported target is not equivalent
  after identity rewriting.
- The aggregate proof is deterministic and hash-only. It records resource keys,
  status counts, refusal codes, SHA-256 hashes, and a proof hash while omitting
  raw post titles, post content, slugs, and postmeta payloads.

Observed generated target shape:

```json
{
  "target": "productionImporterExporterIdentityMapVariant3",
  "family": "production-importer-exporter-identity-map-v3",
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
  },
  "releaseGate": "NO-GO",
  "productionBacked": false
}
```

Invariant summary:

```json
{
  "mapAlias": "pushIdentityMap",
  "identityMapSource": "base-snapshot.meta.identityMap[2].resources[0]",
  "sourceIdentityNotMutated": true,
  "importedTargetKeptRemote": true,
  "childPostParentRewritten": true,
  "sourcePostmetaRewrittenToImportedTarget": true,
  "staleImportedTargetFailsClosed": true,
  "evidenceMode": "hash-only"
}
```

## Remaining unmapped WordPress surfaces

RPP-0360 keeps importer/exporter identity maps bounded to explicit
`pushIdentityMap` entries whose imported remote target rows are present and
equivalent after scalar identity rewriting. The remaining unmapped WordPress
surfaces continue to fail closed unless a future owner/driver, parser-aware
mapper, or explicit equivalent remote identity proof covers them:

- `wp_posts.post_type = nav_menu_item` rows.
- `wp_posts.post_type = revision` rows.
- Unmapped `wp_navigation` rows.
- Menu item graph metadata such as `_menu_item_object`,
  `_menu_item_object_id`, `_menu_item_menu_item_parent`, `_menu_item_type`, and
  `menu_item_parent`.
- `wp_term_taxonomy.taxonomy = nav_menu` rows and dependent nav-menu
  `wp_term_relationships` rows.
- Custom/plugin taxonomy rows that do not have an explicit, equivalent remote
  identity-map target.
- Serialized block references in post content or excerpts that require
  parser-aware graph identity mapping instead of scalar ID rewriting.
- Importer/exporter map entries for an unsupported table outside the supported
  WordPress graph identity-map surfaces.
- Stale, missing, ambiguous, or non-equivalent imported targets.

## Validation commands

```sh
node --check test/rpp-0360-production-importer-exporter-identity-map-v3.test.js
node --test --test-name-pattern RPP-0360 test/rpp-0360-production-importer-exporter-identity-map-v3.test.js
node --test --test-name-pattern RPP-0380 test/rpp-0380-production-importer-exporter-identity-map-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0360-production-importer-exporter-identity-map-v3.md
git diff --check
git diff --cached --check
```

Observed local result: syntax check exited 0; the focused RPP-0360 test
reported 2 subtests with 0 failures; the adjacent RPP-0380 test reported 2
subtests with 0 failures; artifact redaction scan returned `ok: true`; and
both whitespace diff checks exited 0.

## Integration recommendation

Integrate this as support-only graph-identity evidence. It proves deterministic
generated coverage for production-shaped importer/exporter identity-map ready
and stale behavior, and keeps release posture at `NO-GO`.
