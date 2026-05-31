# RPP-0349 category term taxonomy reference v3 evidence

Date: 2026-05-31
Lane: RPP-0349 category term taxonomy reference, variant 3
Checklist item: RPP-0349 - Add generated coverage for category term taxonomy reference, variant 3.
Final release posture: `NO-GO`

## Scope

This is local support evidence for the category `wp_term_taxonomy` graph-identity
surface. The generated harness already has generic `wp_term_taxonomy` variant-3
coverage, but it does not isolate the category term-taxonomy reference path, so
this slice adds a focused local test and this evidence note instead of editing
the generated harness.

No production release was run. This evidence does not change plugin-driver,
executor/auth, recovery, storage, or progress surfaces.

## Proof Surface

`test/rpp-0349-category-term-taxonomy-reference-v3.test.js` covers four local
planner/apply shapes:

- A ready identity-map case maps a local category term and local
  `wp_term_taxonomy` row to equivalent remote rows. The dependent
  `wp_term_relationships.term_taxonomy_id` mutation is rewritten to the remote
  term-taxonomy id and then applied.
- A ready stable-target case keeps an unchanged category `wp_term_taxonomy` row
  stable across base, local, remote, and applied snapshots while creating a
  relationship that references it without rewrite.
- A stale category target case blocks a new relationship when the referenced
  category `wp_term_taxonomy` row drifted remotely after the pull base.
- An unsupported taxonomy case blocks a `product_cat` term-taxonomy row and its
  dependent relationship before mutation.

## Hash-Only Graph Evidence

The focused test builds local proof envelopes with resource keys, numeric ids,
boolean invariants, and hashes only. It asserts the serialized evidence does not
include raw fixture term names, slugs, or descriptions.

The ready identity-map envelope records this shape:

```json
{
  "target": "categoryTermTaxonomyReferenceVariant3",
  "variant": "ready-identity-map-rewrite",
  "evidenceScope": "local-graph-identity-apply-shaped",
  "productionBacked": false,
  "releaseGate": "NO-GO",
  "taxonomy": "category",
  "relationship": {
    "relationshipKey": "wp_term_relationships.term_taxonomy_id",
    "relationshipType": "term-relationship-taxonomy",
    "field": "term_taxonomy_id",
    "plannedTermTaxonomyId": 349211,
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
target resource keys, refusal code `PLAN_NOT_READY`, before/after remote hashes,
and blocker/reason hashes. They do not include row payloads.

## Validation Commands

```sh
node --check test/rpp-0349-category-term-taxonomy-reference-v3.test.js
node --test --test-name-pattern RPP-0349 test/rpp-0349-category-term-taxonomy-reference-v3.test.js
node --test test/rpp-0369-category-term-taxonomy-reference-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0349-category-term-taxonomy-reference-v3.md
git diff --check
```

Observed local result: syntax check passed; the focused RPP-0349 run reported 5
subtests, 0 failures; adjacent RPP-0369 category taxonomy graph coverage
reported 2 subtests, 0 failures; artifact redaction scan returned `ok:true`;
and whitespace diff check passed.

This lane remains local support evidence only; final release remains `NO-GO`
until a separate production-backed release proof satisfies the broader release
gates.
