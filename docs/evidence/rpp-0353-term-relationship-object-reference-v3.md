# RPP-0353 term relationship object reference v3 evidence

Date: 2026-05-31
Lane: RPP-0353 term relationship object reference, variant 3
Checklist item: RPP-0353 - Add generated coverage for term relationship object reference, variant 3.
Final release posture: `NO-GO`

## Scope

This is local support evidence for the `wp_term_relationships.object_id`
graph-reference surface. It adds only the focused RPP-0353 test and this
evidence note. It does not edit generated harness sources, release artifacts,
checklist files, progress surfaces, plugin-driver, executor/auth, recovery, or
storage/performance code.

## Proof Surface

`test/rpp-0353-term-relationship-object-reference-v3.test.js` samples existing
generated harness cases tagged for both the term-relationship object surface and
the variant-3 relationship graph surface.

The focused proof verifies:

- generated variant-3 coverage includes 10 term-relationship object cases, one
  per tier 0 through 9;
- the generated coverage has 5 ready cases and 5 stale/non-ready cases;
- the selected ready case plans and applies the relationship row with a
  live-remote precondition, keeps the referenced object target stable through
  apply, preserves unplanned remote data, and rejects stale replay with
  `PRECONDITION_FAILED`;
- the selected generated stale case remains blocked and refuses apply with
  `PLAN_NOT_READY` before mutation; and
- a derived stale-object check from the generated ready fixture blocks the
  relationship specifically on `wp_term_relationships.object_id`, plans no
  relationship mutation, and refuses apply before mutation.

## Hash-Only Evidence

The test builds a support-only envelope with resource keys, tags, counts,
statuses, refusal codes, booleans, and SHA-256 hashes. It explicitly scans the
serialized proof for generated term/taxonomy labels, slugs, remote-only file
notes, stale object drift markers, and raw post fields.

Deterministic coverage shape:

```json
{
  "target": "termRelationshipObjectReferenceVariant3",
  "generatedHarnessTags": [
    "term-relationship-object-graph",
    "wp-term-relationships-graph-v3"
  ],
  "total": 10,
  "perTier": {
    "0": 1,
    "1": 1,
    "2": 1,
    "3": 1,
    "4": 1,
    "5": 1,
    "6": 1,
    "7": 1,
    "8": 1,
    "9": 1
  },
  "statuses": {
    "blocked": 5,
    "ready": 5
  },
  "readyCases": 5,
  "staleCases": 5
}
```

Selected proof variants:

```json
[
  {
    "variant": "generated-ready-object-reference-v3",
    "relationshipKey": "wp_term_relationships.object_id",
    "targetStableAcrossGeneratedSnapshots": true,
    "applyPreservedTarget": true,
    "releaseGate": "NO-GO"
  },
  {
    "variant": "generated-stale-object-reference-v3",
    "plannedRelationshipMutation": false,
    "applyRefusal": "PLAN_NOT_READY",
    "releaseGate": "NO-GO"
  },
  {
    "variant": "derived-stale-object-reference-v3",
    "relationshipKey": "wp_term_relationships.object_id",
    "targetRemoteChanged": true,
    "plannedRelationshipMutation": false,
    "applyRefusal": "PLAN_NOT_READY",
    "releaseGate": "NO-GO"
  }
]
```

This remains local generated support evidence only. It is not production-backed
release evidence and does not change the final release recommendation.

## Validation Commands

```sh
node --check test/rpp-0353-term-relationship-object-reference-v3.test.js
node --test --test-name-pattern RPP-0353 test/rpp-0353-term-relationship-object-reference-v3.test.js
node --test --test-name-pattern RPP-0373 test/rpp-0373-term-relationship-object-reference-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0353-term-relationship-object-reference-v3.md
git diff --check
```

Observed local result: syntax check passed; the focused RPP-0353 run reported 1
subtest and 0 failures; the adjacent RPP-0373 object-reference run reported 1
subtest and 0 failures; artifact redaction scan returned `ok:true`; and
whitespace diff check passed.
