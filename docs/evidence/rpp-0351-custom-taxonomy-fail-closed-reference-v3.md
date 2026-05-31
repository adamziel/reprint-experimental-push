# RPP-0351 custom taxonomy fail-closed reference v3 evidence

Date: 2026-05-31
Lane: RPP-0351 custom taxonomy fail-closed reference, variant 3
Checklist item: RPP-0351 - Add generated coverage for custom taxonomy fail-closed reference, variant 3.
Final release posture: `NO-GO`

## Scope

This slice adds local support evidence for custom taxonomy
`wp_term_taxonomy` references. It keeps the proof focused on one test and this
evidence note. No production release was run, and no progress or release status
surface is updated here.

## Proof Surface

`test/rpp-0351-custom-taxonomy-fail-closed-reference-v3.test.js` covers three
deterministic planner/apply shapes:

- An unsupported custom taxonomy target creates a local `product_cat`
  `wp_term_taxonomy` row and a dependent
  `wp_term_relationships.term_taxonomy_id` row. The planner emits
  `stale-wordpress-graph-identity` blockers for the taxonomy row and the
  dependent relationship, does not plan either unsafe mutation, and `applyPlan()`
  refuses the blocked plan before the remote snapshot changes.
- A partially mapped custom taxonomy target maps only the source term row to a
  remote term. Because the `wp_term_taxonomy` target itself is unmapped, the
  dependent relationship still fails closed before mutation with hash-only
  target evidence.
- A supported mapper path provides explicit identity-map rows for both the
  source term and source term-taxonomy rows. The planner preserves the remote
  targets, rewrites the relationship to the proven remote `term_taxonomy_id`,
  and applies only that rewritten relationship with live-remote preconditions.

## Hash-Only Graph Evidence

The focused test builds proof envelopes from resource keys, numeric ids,
decision labels, boolean invariants, and hashes. It asserts that serialized
proofs do not include raw term names, slugs, descriptions, or raw row payload
fields. Each proof is recomputed in the test and compared for deterministic
equality.

Fail-closed custom taxonomy reference shape:

```json
{
  "target": "customTaxonomyFailClosedReferenceVariant3",
  "variant": "unsupported-custom-taxonomy-target",
  "evidenceScope": "local-graph-identity-support-proof",
  "productionBacked": false,
  "releaseGate": "NO-GO",
  "taxonomy": "product_cat",
  "relationship": {
    "relationshipKey": "wp_term_relationships.term_taxonomy_id",
    "relationshipType": "term-relationship-taxonomy",
    "targetSupportClass": "stale-wordpress-graph-identity",
    "targetSupportReasonHash": "sha256:<64 lowercase hex>"
  },
  "hashes": {
    "targetLocal": "<64 lowercase hex>",
    "targetRemote": "<64 lowercase hex>",
    "remoteBefore": "<64 lowercase hex>",
    "remoteAfter": "<64 lowercase hex>",
    "refusalDetails": "sha256:<64 lowercase hex>"
  },
  "refusal": {
    "code": "PLAN_NOT_READY",
    "phase": "before-mutation"
  }
}
```

Supported custom taxonomy mapper shape:

```json
{
  "target": "customTaxonomyFailClosedReferenceVariant3",
  "variant": "ready-explicit-identity-map-rewrite",
  "evidenceScope": "local-graph-identity-support-proof",
  "productionBacked": false,
  "releaseGate": "NO-GO",
  "taxonomy": "product_cat",
  "relationship": {
    "relationshipKey": "wp_term_relationships.term_taxonomy_id",
    "relationshipType": "term-relationship-taxonomy",
    "field": "term_taxonomy_id",
    "plannedTermTaxonomyId": 351711,
    "rewriteHash": "sha256:<64 lowercase hex>"
  },
  "hashes": {
    "relationshipPrecondition": "<64 lowercase hex>",
    "relationshipPlannedLocal": "<64 lowercase hex>",
    "relationshipApplied": "<64 lowercase hex>",
    "targetTermTaxonomyRemote": "<64 lowercase hex>",
    "targetTermTaxonomyApplied": "<64 lowercase hex>"
  }
}
```

The mapper is therefore pinned on both sides: it refuses unsupported or unmapped
custom taxonomy references before mutation, and it rewrites only after explicit
stable target identity evidence exists.

## Validation Commands

```sh
node --check test/rpp-0351-custom-taxonomy-fail-closed-reference-v3.test.js
node --test --test-name-pattern RPP-0351 test/rpp-0351-custom-taxonomy-fail-closed-reference-v3.test.js
node --test --test-name-pattern RPP-0331 test/rpp-0331-custom-taxonomy-fail-closed-reference-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0351-custom-taxonomy-fail-closed-reference-v3.md
git diff --check
```

Observed local result after the update: syntax check passed; the focused
RPP-0351 test reported 3 subtests, 0 failures; the adjacent RPP-0331 custom
taxonomy fail-closed test reported 2 subtests, 0 failures; artifact redaction
scan returned `ok:true`; and whitespace diff check passed.

This remains local support evidence only. Final release remains `NO-GO` until a
separate production-backed release proof satisfies the broader release gates.
