# RPP-0354 term relationship taxonomy reference v3 evidence

Date: 2026-05-31
Lane: RPP-0354 term relationship taxonomy reference, variant 3
Checklist item: RPP-0354 - Add generated coverage for term relationship taxonomy reference, variant 3.
Final release posture: `NO-GO`

## Scope

This is local support evidence for the
`wp_term_relationships.term_taxonomy_id` graph-identity reference to a
supported `wp_term_taxonomy` target. It adds only a focused local test and this
evidence note. It does not edit generated harness sources, checklist/progress
surfaces, release scripts, plugin-driver, executor/auth, recovery, storage, or
performance files.

No production release was run. The final release recommendation remains
`NO-GO` because this is deterministic support evidence only.

## Proof Surface

`test/rpp-0354-term-relationship-taxonomy-reference-v3.test.js` covers four
local planner/apply shapes:

- A ready identity-map case maps a local category term and local
  `wp_term_taxonomy` row to equivalent remote rows. The dependent
  `wp_term_relationships` mutation is rewritten from the local taxonomy target
  to the remote taxonomy target and then applied.
- A ready stable-target case proves the supported category taxonomy identity is
  unchanged across base, local, remote, and applied snapshots while the
  relationship carries that target without rewrite.
- A stale taxonomy target case blocks a new term relationship when the
  referenced `wp_term_taxonomy` row drifted remotely after the pull base.
- An unsupported taxonomy target case blocks the taxonomy row and its dependent
  relationship before mutation.

## Hash-Only Graph Evidence

The proof envelopes use resource keys, counts, reason codes, booleans, and
hashes. They intentionally exclude raw term names, slugs, taxonomy
descriptions, and row payload values.

The ready rewrite envelope records this shape:

```json
{
  "target": "termRelationshipTaxonomyReferenceVariant3",
  "variant": "ready-identity-map-rewrite",
  "evidenceScope": "local-graph-identity-apply-shaped",
  "productionBacked": false,
  "releaseGate": "NO-GO",
  "relationship": {
    "relationshipKey": "wp_term_relationships.term_taxonomy_id",
    "relationshipType": "term-relationship-taxonomy",
    "field": "term_taxonomy_id",
    "sourceTargetResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:<local>\"]",
    "targetResourceKey": "row:[\"wp_term_taxonomy\",\"term_taxonomy_id:<remote>\"]",
    "rewriteHash": "sha256:<64 lowercase hex>"
  },
  "counts": {
    "mutations": 1,
    "preconditions": 1,
    "blockers": 0
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
target resource keys, target support class, refusal code `PLAN_NOT_READY`,
before/after remote hashes, and blocker/reason hashes. They do not include raw
taxonomy or term payloads.

## Validation Commands

```sh
node --check test/rpp-0354-term-relationship-taxonomy-reference-v3.test.js
node --test --test-name-pattern RPP-0354 test/rpp-0354-term-relationship-taxonomy-reference-v3.test.js
node --test test/rpp-0374-term-relationship-taxonomy-reference-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0354-term-relationship-taxonomy-reference-v3.md
git diff --check
```

Observed local result after implementation: syntax check passed; the focused
RPP-0354 run reported 5 subtests, 0 failures; adjacent RPP-0374 term
relationship taxonomy coverage reported 2 subtests, 0 failures; artifact
redaction scan returned `ok:true`; and whitespace diff check passed.

This lane remains local support evidence only; final release remains `NO-GO`.
