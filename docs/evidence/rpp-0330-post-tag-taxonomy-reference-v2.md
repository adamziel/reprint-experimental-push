# RPP-0330 post_tag taxonomy reference v2 evidence

Date: 2026-05-30
Lane: RPP-0330 post_tag taxonomy reference, variant 2
Checklist item: RPP-0330 - Prove post_tag taxonomy reference, variant 2.

## Scope

This is a focused local-production verifier carry-through proof for the built-in
`post_tag` `wp_term_taxonomy` target. It adds only the RPP-0330 focused test and
this evidence note. It does not change planner, apply, local-production helper,
generated harness, release scripts, checklist state, progress surfaces, or
adjacent RPP-0310/RPP-0370/RPP-0390 files.

## Proof surface

`test/rpp-0330-post-tag-taxonomy-reference-v2.test.js` builds a ready
local-production-shaped source/local/remote fixture where the local snapshot
creates the post_tag taxonomy graph closure:

```json
{
  "termResourceKey": "row:[\"wp_terms\",\"term_id:72931\"]",
  "termTaxonomyResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:72941\"]",
  "relationshipResourceKey": "row:[\"wp_term_relationships\",\"object_id:71002|term_taxonomy_id:72941\"]"
}
```

The positive test applies the ready plan to the remote snapshot, wraps the same
plan in the local-production release-verifier summary shape, and feeds that
summary through `buildComplexSiteReleaseEvidence()` with
`postTagTaxonomyGraph` required. The proof requires the post_tag
`wp_term_taxonomy` mutation to:

- be present as row `term_taxonomy_id:72941`;
- carry `term_id:72931` and `taxonomy:"post_tag"`;
- have a live-remote precondition hash matching mutation base and
  remote-before hashes;
- appear in apply-time revalidation before the first mutation; and
- hash-match the local target after apply.

The negative test removes only the post_tag `wp_term_taxonomy` resource key from
apply-time revalidation. The verifier evidence then returns `ok:false`, while
the mutation, post_tag term reference, live precondition, and applied local hash
remain true. This proves variant 2 fails closed specifically when verifier
carry-through through apply is absent.

## Hash-only evidence

The persisted RPP-0330 carry-through envelope is limited to resource keys,
numeric IDs, taxonomy type, boolean invariants, 64-character hashes, a proof
hash, and release caveats:

```json
{
  "target": "postTagTaxonomyReferenceVariant2",
  "evidenceScope": "local-production-verifier-carry-through",
  "resourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:72941\"]",
  "termResourceKey": "row:[\"wp_terms\",\"term_id:72931\"]",
  "relationshipResourceKey": "row:[\"wp_term_relationships\",\"object_id:71002|term_taxonomy_id:72941\"]",
  "termTaxonomyId": 72941,
  "termId": 72931,
  "taxonomy": "post_tag",
  "hashes": {
    "base": "<64 lowercase hex>",
    "remoteBefore": "<64 lowercase hex>",
    "precondition": "<64 lowercase hex>",
    "local": "<64 lowercase hex>",
    "applied": "<64 lowercase hex>",
    "receipt": "<64 lowercase hex>"
  },
  "release": {
    "productionBacked": false,
    "finalRecommendation": "NO-GO",
    "caveat": "local-production-verifier-evidence-only"
  },
  "proofHash": "sha256:<64 lowercase hex>"
}
```

The focused assertions scan the serialized verifier/carry-through evidence for
private fixture term, slug, and description markers. Raw row payloads remain
outside the persisted evidence envelope.

## Remaining unmapped WordPress surfaces

`post_tag` is covered by the local-production verifier carry-through proof for
the core post-object taxonomy path. The remaining intentionally unmapped or
fail-closed WordPress surfaces stay documented here:

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

## Validation commands

```sh
node --check test/rpp-0330-post-tag-taxonomy-reference-v2.test.js
node --test test/rpp-0330-post-tag-taxonomy-reference-v2.test.js
node --test test/rpp-0370-post-tag-taxonomy-reference-v4.test.js test/rpp-0390-post-tag-taxonomy-reference-release-verifier-v5.test.js
node --test --test-name-pattern='post_tag|taxonomy reference|RPP-0330|RPP-0370|RPP-0390|complex-site planner proof covers real post_tag taxonomy graph closure|complex-site release evidence proves post_tag taxonomy carries through apply|complex-site release evidence fails closed when post_tag taxonomy is changed' test/rpp-0330-post-tag-taxonomy-reference-v2.test.js test/rpp-0370-post-tag-taxonomy-reference-v4.test.js test/rpp-0390-post-tag-taxonomy-reference-release-verifier-v5.test.js test/local-production-complex-site-proof.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0330-post-tag-taxonomy-reference-v2.md
git diff --check
```

Observed local result after the update: syntax check passed; the focused
RPP-0330 test reported 3 subtests, 0 failures; the adjacent
RPP-0329/RPP-0370/RPP-0390/local-production proof run reported 27 subtests, 0
failures; artifact redaction scan for this Markdown evidence returned
`ok:true`; and whitespace diff check passed.

## Release posture

This lane is local-production verifier carry-through evidence only. It is not a
live external production release run, does not publish release artifacts, and
does not satisfy the final production evidence boundary. Final release remains
`NO-GO` until separate checked production evidence satisfies the broader release
gate set.
