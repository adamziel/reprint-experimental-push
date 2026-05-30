# RPP-0329 category term taxonomy reference v2 evidence

Date: 2026-05-30
Lane: RPP-0329 category term taxonomy reference, variant 2
Checklist item: RPP-0329 — Prove category term taxonomy reference, variant 2.

## Scope

This is a focused local-production verifier carry-through proof for the built-in
category `wp_term_taxonomy` target. It adds only the RPP-0329 focused test and
this evidence note. It does not change planner, apply, local-production helper,
generated harness, release scripts, checklist state, progress surfaces, or
adjacent RPP-0309/RPP-0389 files.

## Proof surface

`test/rpp-0329-category-term-taxonomy-reference-v2.test.js` builds a ready
local-production-shaped source/local/remote fixture where the local snapshot
creates the category taxonomy graph closure:

```json
{
  "termResourceKey": "row:[\"wp_terms\",\"term_id:72901\"]",
  "termTaxonomyResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:72911\"]",
  "relationshipResourceKey": "row:[\"wp_term_relationships\",\"object_id:71001|term_taxonomy_id:72911\"]",
  "termmetaResourceKey": "row:[\"wp_termmeta\",\"meta_id:72921\"]"
}
```

The positive test applies the ready plan to the remote snapshot, wraps the same
plan in the local-production release-verifier summary shape, and feeds that
summary through `buildComplexSiteReleaseEvidence()`. The proof requires the
category `wp_term_taxonomy` mutation to:

- be present as row `term_taxonomy_id:72911`;
- carry `term_id:72901` and `taxonomy:"category"`;
- have a live-remote precondition hash matching mutation base and
  remote-before hashes;
- appear in apply-time revalidation before the first mutation; and
- hash-match the local target after apply.

The negative test removes only the category `wp_term_taxonomy` resource key from
apply-time revalidation. The verifier evidence then returns `ok:false`, while
the mutation, term reference, live precondition, and applied local hash remain
true. This proves variant 2 fails closed specifically when verifier
carry-through through apply is absent.

## Hash-only evidence

The persisted RPP-0329 carry-through envelope is limited to resource keys,
numeric IDs, taxonomy type, boolean invariants, 64-character hashes, a proof
hash, and release caveats:

```json
{
  "target": "categoryTermTaxonomyReferenceVariant2",
  "evidenceScope": "local-production-verifier-carry-through",
  "resourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:72911\"]",
  "termResourceKey": "row:[\"wp_terms\",\"term_id:72901\"]",
  "termTaxonomyId": 72911,
  "termId": 72901,
  "taxonomy": "category",
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
private fixture term, slug, description, and termmeta markers. Raw row payloads
remain outside the persisted evidence envelope.

## Validation commands

```sh
node --check test/rpp-0329-category-term-taxonomy-reference-v2.test.js
node --test test/rpp-0329-category-term-taxonomy-reference-v2.test.js
node --test test/rpp-0309-category-term-taxonomy-reference.test.js test/rpp-0389-category-term-taxonomy-reference-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0329-category-term-taxonomy-reference-v2.md
git diff --check
```

Observed local result after the update: syntax check passed; the focused
RPP-0329 test reported 2 subtests, 0 failures; the adjacent RPP-0309/RPP-0389
category taxonomy run reported 5 subtests, 0 failures; artifact redaction scan
for this Markdown evidence returned `ok:true`; and whitespace diff check passed.

## Release posture

This lane is local-production verifier carry-through evidence only. It is not a
live external production release run, does not publish release artifacts, and
does not satisfy the final production evidence boundary. Final release remains
`NO-GO` until separate checked production evidence satisfies the broader release
gate set.
