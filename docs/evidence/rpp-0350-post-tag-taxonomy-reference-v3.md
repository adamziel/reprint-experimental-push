# RPP-0350 post_tag taxonomy reference v3 evidence

Date: 2026-05-31
Lane: RPP-0350 post_tag taxonomy reference, variant 3
Checklist item: RPP-0350 - Add generated coverage for post_tag taxonomy reference, variant 3.
Final release posture: `NO-GO`

## Scope

This is local support evidence for the built-in `post_tag`
`wp_term_taxonomy` graph-identity surface. The slice adds only the focused
RPP-0350 test and this evidence note. It does not modify plugin-driver,
executor/auth, recovery, storage/performance, checklist, progress, release
publish, or generated progress surfaces.

No production release was run. This evidence is support-only and does not claim
production release readiness.

## Proof Surface

`test/rpp-0350-post-tag-taxonomy-reference-v3.test.js` covers four local
planner/apply shapes:

- A ready identity-map case maps a local tag term and local
  `wp_term_taxonomy` row to equivalent remote post_tag rows. The dependent
  `wp_term_relationships.term_taxonomy_id` mutation is rewritten to the remote
  term-taxonomy id and then applied.
- A ready stable-target case keeps an unchanged post_tag `wp_term_taxonomy` row
  stable across base, local, remote, and applied snapshots while creating a
  relationship that references it without rewrite.
- A stale post_tag target case blocks a new relationship when the referenced
  post_tag `wp_term_taxonomy` row drifted remotely after the pull base.
- An unsupported `nav_menu` taxonomy case blocks the taxonomy row and its
  dependent relationship before mutation, preserving the unmapped navigation
  caveat.

## Hash-Only Graph Evidence

The local proof envelopes contain resource keys, numeric ids, taxonomy labels,
boolean invariants, refusal codes, and hashes only. The focused assertions scan
serialized proof envelopes to ensure raw fixture names, slugs, descriptions,
and row payload values are not included.

The ready identity-map envelope records this shape:

```json
{
  "target": "postTagTaxonomyReferenceVariant3",
  "variant": "ready-identity-map-rewrite",
  "evidenceScope": "local-graph-identity-apply-shaped",
  "productionBacked": false,
  "releaseGate": "NO-GO",
  "taxonomy": "post_tag",
  "relationship": {
    "relationshipKey": "wp_term_relationships.term_taxonomy_id",
    "relationshipType": "term-relationship-taxonomy",
    "field": "term_taxonomy_id",
    "plannedTermTaxonomyId": 350211,
    "rewriteHash": "sha256:<64 lowercase hex>"
  },
  "hashes": {
    "relationshipPrecondition": "<64 lowercase hex>",
    "relationshipPlannedLocal": "<64 lowercase hex>",
    "relationshipApplied": "<64 lowercase hex>",
    "targetTermTaxonomyRemote": "<64 lowercase hex>",
    "targetTermTaxonomyApplied": "<64 lowercase hex>"
  },
  "release": {
    "productionBacked": false,
    "finalRecommendation": "NO-GO",
    "caveat": "local-support-evidence-only"
  },
  "proofHash": "sha256:<64 lowercase hex>"
}
```

The stale and unsupported envelopes include blocker classes, relationship keys,
target resource keys, refusal code `PLAN_NOT_READY`, before/after remote
hashes, and blocker/reason hashes. They do not include row payloads.

## Remaining unmapped WordPress surfaces

`post_tag` is covered by this local support proof for the core post-object
taxonomy path. The remaining intentionally unmapped or fail-closed WordPress
surfaces stay documented here:

- `wp_term_taxonomy.taxonomy = nav_menu` rows and dependent menu taxonomy
  `wp_term_relationships` rows.
- Custom/plugin taxonomy rows without an explicit equivalent identity-map target.
- `wp_posts.post_type = nav_menu_item` rows and menu item graph metadata such as
  `_menu_item_object_id`, `_menu_item_menu_item_parent`, `_menu_item_object`,
  `_menu_item_type`, and `menu_item_parent`.
- Unsupported post graph rows such as `revision` and `wp_navigation`.
- Serialized block references in post content or excerpts that require
  parser-aware graph identity mapping.

Those surfaces continue to stop as `stale-wordpress-graph-identity` blockers
with hash-only target/change evidence unless a future focused proof adds a
supported identity map or owner/driver boundary.

## Validation Commands

```sh
node --check test/rpp-0350-post-tag-taxonomy-reference-v3.test.js
node --test --test-name-pattern RPP-0350 test/rpp-0350-post-tag-taxonomy-reference-v3.test.js
node --test test/rpp-0370-post-tag-taxonomy-reference-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0350-post-tag-taxonomy-reference-v3.md
git diff --check
```

Observed local result: syntax check passed; the focused RPP-0350 run reported
5 subtests, 0 failures; adjacent RPP-0370 post_tag taxonomy graph coverage
reported 2 subtests, 0 failures; artifact redaction scan returned `ok:true`;
and whitespace diff check passed.

This lane remains local support evidence only; final release remains `NO-GO`
until a separate production-backed release proof satisfies the broader release
gates.
