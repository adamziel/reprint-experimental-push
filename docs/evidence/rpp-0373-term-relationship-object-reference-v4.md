# RPP-0373 term relationship object reference variant 4 evidence

Date: 2026-05-30
Lane: RPP-0373 term relationship object reference, variant 4
Checklist item: RPP-0373 — Add focused regression coverage for term relationship object reference, variant 4.

## Scope

This slice stays inside focused local/model graph-identity proof for
`wp_term_relationships.object_id`. It adds one test file and this evidence note,
then updates only the RPP-0373 checklist row. It does not touch public progress
surfaces, generated harness sources, auth, recovery, storage, production release
verifiers, or release publish artifacts.

## Invariant

A generated-ready `wp_term_relationships` row may be planned only when its
`object_id` post target is proven safe in the same plan. A generated-stale
relationship that points at a post changed on the live remote since the pull base
must be blocked as `stale-wordpress-graph-identity`, omit raw row values from
blocker evidence, and refuse apply before mutating the remote snapshot.

## Evidence added

- `test/rpp-0373-term-relationship-object-reference-v4.test.js` builds two
  deterministic local/generated cases for the focused object-reference surface.
- The generated-ready case creates a post target, category term, term-taxonomy
  row, and relationship row in one plan. The relationship mutation carries the
  expected `object_id`, has a matching live-remote precondition, applies to the
  remote clone, preserves an unplanned remote-only file, and rejects a stale
  replay with `PRECONDITION_FAILED` before mutation.
- The generated-stale case keeps the local post target equal to base while the
  remote post target changes. The planner blocks the relationship row, records a
  single `wp_term_relationships.object_id` reference with hash-only target
  change evidence, leaves the relationship unplanned, and `applyPlan()` refuses
  with `PLAN_NOT_READY` before mutation.
- Both cases build a local hash-only evidence envelope. The test asserts model
  proof hashes, resource hashes, blocker/refusal hashes, and redacted payload
  hashes while checking that raw private post, term, taxonomy, relationship, and
  remote-only fixture strings are absent.

## Observed local/model shapes

Generated-ready object-reference apply path:

```json
{
  "variant": "generated-ready",
  "relationshipKey": "wp_term_relationships.object_id",
  "relationshipType": "term-relationship-object",
  "targetResourceKey": "row:[\"wp_posts\",\"ID:737301\"]",
  "sourceResourceKey": "row:[\"wp_term_relationships\",\"object_id:737301|term_taxonomy_id:737321\"]",
  "samePlanTargetCreate": true,
  "relationshipChangeKind": "create",
  "precondition": "live-remote",
  "staleReplayRefusal": "PRECONDITION_FAILED",
  "rawValuesIncluded": false
}
```

Generated-stale object-reference fail-closed path:

```json
{
  "variant": "generated-stale",
  "class": "stale-wordpress-graph-identity",
  "relationshipKeys": ["wp_term_relationships.object_id"],
  "targetResourceKey": "row:[\"wp_posts\",\"ID:737303\"]",
  "targetLocalChange": "unchanged",
  "targetRemoteChange": "update",
  "plannedRelationshipMutation": false,
  "applyRefusal": "PLAN_NOT_READY",
  "rawValuesIncluded": false
}
```

The proof scope is local/generated model evidence only. It does not claim
production-backed release evidence or a release-verifier carry-through.

## Validation commands

```sh
node --check test/rpp-0373-term-relationship-object-reference-v4.test.js
node --test test/rpp-0373-term-relationship-object-reference-v4.test.js
grep -RInE "term relationship object|object_id|RPP-0313|RPP-0333|RPP-0353" test docs
node --test --test-name-pattern='RPP-0173|RPP-0153|RPP-0315' test/generated-push-harness.test.js test/rpp-0315-nav-menu-item-fail-closed-reference.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0373-term-relationship-object-reference-v4.md docs/reprint-push-completion-checklist.md
git diff --check && git diff --cached --check
```

Observed local results after the test, evidence, and checklist update: focused
syntax check returned exit code 0; focused node test reported 1 subtest and 0
failures; the adjacent generated/nav-menu relationship slice reported 3 subtests
and 0 failures; checklist lint, artifact redaction scan, and whitespace checks
returned exit code 0.
