# RPP-0400 importer/exporter identity-map release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0400 production importer/exporter identity map release verifier carry-through, variant 5
Checklist item: RPP-0400 — Carry through the release verifier for production importer/exporter identity map, variant 5.

## Scope

This adds release-verifier carry-through for the existing production-shaped
importer/exporter `pushIdentityMap` proof. The verifier now emits a hash-only
`graphIdentity.productionImporterExporterIdentityMap` support proof beside the
other production-shaped verifier summaries.

The proof is local production-shaped evidence only. It is not live external
production evidence and keeps release posture at **NO-GO** until the broader
production boundary is satisfied.

## Proof surface

`test/rpp-0400-importer-exporter-identity-map-release-verifier-v5.test.js`
verifies that the release verifier:

- reads a base-snapshot `pushIdentityMap` entry from
  `base-snapshot.meta.identityMap[2].resources[0]`;
- maps the exported local source post to the imported remote target post and
  preserves the imported remote target row;
- rewrites both dependent child `post_parent` and `wp_postmeta.post_id`
  references to the imported target ID;
- plans only the rewritten dependent rows with one-to-one live-remote
  preconditions;
- blocks a stale imported target as `stale-wordpress-graph-identity` before
  mutation; and
- serializes only resource keys, IDs, and hashes, never raw post titles,
  post content, or meta values.

## Remaining unmapped or fail-closed WordPress surfaces

- `nav_menu` taxonomy rows, menu-item graph metadata, `nav_menu_item` posts,
  `wp_navigation` posts, revisions, and custom/plugin taxonomies such as
  `product_cat` remain intentionally unmapped without a separate owner/driver
  or explicit identity-map proof.
- Importer/exporter identity maps remain bounded to explicit `pushIdentityMap`
  entries whose remote target rows exist and are equivalent after identity
  rewriting.
- Stale, missing, duplicate, or non-equivalent imported targets continue to
  fail closed as `stale-wordpress-graph-identity` with hash-only evidence.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0400-importer-exporter-identity-map-release-verifier-v5.test.js
node --test test/rpp-0400-importer-exporter-identity-map-release-verifier-v5.test.js
node --test --test-name-pattern 'importer exporter identity maps|explicit WordPress graph identity map|RPP-0400' test/local-production-complex-site-proof.test.js test/push-planner.test.js test/rpp-0400-importer-exporter-identity-map-release-verifier-v5.test.js
node --test test/graph-mapping-inventory.test.js test/rpp-0400-importer-exporter-identity-map-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0400-importer-exporter-identity-map-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0400
test reported 2 subtests ok, 0 failed. The adjacent importer/exporter graph
slice plus focused verifier reported 6 subtests ok, 0 failed. The graph
inventory plus RPP-0400 run
reported 4 subtests ok, 0 failed. Checklist lint returned `"ok": true`; the
scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This is support-only release-verifier carry-through. The proof is explicitly
`productionBacked: false`, `releaseEligible: false`, and `releaseGate: "NO-GO"`.
