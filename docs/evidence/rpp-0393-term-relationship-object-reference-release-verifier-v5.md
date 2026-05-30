# RPP-0393 term relationship object reference release verifier variant 5

Date: 2026-05-30
Lane: RPP-0393 term relationship object reference, release-verifier carry-through variant 5
Checklist item: RPP-0393 — Carry through the release verifier for term relationship object reference, variant 5.

## Scope

This slice adds a focused local regression for the generated-harness evidence used by the release-verifier lane. It does not edit the generated harness, production verifier implementation, progress surfaces, release docs, or adjacent RPP-0392/RPP-0394 files.

## Proof surface

`test/rpp-0393-term-relationship-object-reference-release-verifier-v5.test.js` builds a deterministic, hash-only proof envelope over generated cases tagged `term-relationship-object-graph`.

The test verifies:

- the generated harness exposes 10 term-relationship object-reference cases, one per tier 0 through 9;
- the generated coverage includes 5 ready cases and 5 stale/non-ready cases;
- the selected ready case carries a `wp_term_relationships` create with a live-remote precondition, applies the local relationship row, preserves unplanned remote data, and rejects stale replay with `PRECONDITION_FAILED`;
- the selected generated stale case refuses apply with `PLAN_NOT_READY` and leaves the remote unchanged;
- a derived stale-object check from the generated ready fixture fails closed on `wp_term_relationships.object_id` when the referenced `wp_posts` object has remote drift, with no relationship mutation planned; and
- serialized evidence contains only resource keys, counts, statuses, hashes, relationship keys, and refusal codes.

## Deterministic coverage envelope

```json
{
  "target": "termRelationshipObjectReferenceReleaseVerifierVariant5",
  "generatedHarnessTag": "term-relationship-object-graph",
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

The proof remains local/support-only and release gate posture remains `NO-GO`; it is evidence that the release-verifier checklist item has a focused generated-harness ready/stale regression slice, not a production-backed release claim.

## Redaction

The focused test checks that generated term names, slugs, taxonomy descriptions, remote-only file notes, the derived stale-object marker, and raw post title fields are absent from serialized proof evidence. It also runs `assertEvidenceHasNoRawValues()` against the proof envelope.

## Validation commands

```sh
node --check test/rpp-0393-term-relationship-object-reference-release-verifier-v5.test.js
node --test test/rpp-0393-term-relationship-object-reference-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0113|RPP-0133|RPP-0153|RPP-0173' test/generated-push-harness.test.js
node --test --test-name-pattern='term relationship object|RPP-0309|RPP-0311' test/rpp-0393-term-relationship-object-reference-release-verifier-v5.test.js test/rpp-0309-category-term-taxonomy-reference.test.js test/rpp-0311-custom-taxonomy-fail-closed-reference.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0393-term-relationship-object-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md
node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js
git diff --check
git diff --cached --check
```

Observed locally after the focused update: the RPP-0393 focused test reports 1 subtest and 0 failures. The adjacent term-relationship generated-harness slice reports 3 subtests and 0 failures. The adjacent graph-identity slice reports 5 subtests and 0 failures. The release hygiene unit tests report 23 subtests and 0 failures. Checklist lint and scoped artifact redaction scan report `"ok": true`; diff whitespace checks report no errors.
