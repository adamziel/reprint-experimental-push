# RPP-0338 GUID and slug collision handling variant 2 evidence

Date: 2026-05-31
Lane: RPP-0338 GUID and slug collision handling, variant 2
Checklist item: RPP-0338 - Prove GUID and slug collision handling, variant 2.
Success text: generated harness includes ready and stale cases.

## Scope

This is a local generated-harness graph-identity proof. It does not edit the
generated harness fixtures, release verifier, progress page, checklist, or
shared progress log. The slice asserts the existing generated
`postGuidSlugCollision` target from an item-specific regression test.

## Proof surface

- `test/rpp-0338-guid-slug-collision-handling-v2.test.js` filters the generated
  push harness for `post-guid-slug-collision-guard`.
- The generated harness emits 20 target cases: one ready unique GUID/slug post
  and one stale remote identity collision case for each tier 0 through 9.
- Ready cases plan and apply the unique page row, carry a live remote
  precondition, and reject stale replay with `PRECONDITION_FAILED`.
- Stale cases include a remote row with matching `guid` and
  `post_type + post_name`, block the local row as
  `stale-wordpress-graph-identity`, emit `wp_posts.identity` /
  `post-natural-identity-collision` evidence, keep the colliding remote row,
  and refuse apply with `PLAN_NOT_READY` before mutation.
- The aggregate proof built by the test is hash-only: it records resource keys,
  status counts, identity-kind labels, hashes, refusal codes, and a proof hash.
  Raw generated post titles, GUIDs, and slugs are asserted absent.

Observed generated target shape:

```json
{
  "target": "postGuidSlugCollision",
  "family": "post-guid-slug-collision-guard",
  "total": 20,
  "perTier": {
    "0": 2,
    "1": 2,
    "2": 2,
    "3": 2,
    "4": 2,
    "5": 2,
    "6": 2,
    "7": 2,
    "8": 2,
    "9": 2
  },
  "statuses": {
    "blocked": 10,
    "ready": 10
  },
  "readyCases": 10,
  "staleCases": 10
}
```

## Validation commands

```sh
node --check test/rpp-0338-guid-slug-collision-handling-v2.test.js
node --test test/rpp-0338-guid-slug-collision-handling-v2.test.js
node --test --test-name-pattern='RPP-0398 generated harness emits GUID and slug collision ready and stale cases' test/generated-push-harness.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0338-guid-slug-collision-handling-v2.md
git diff --check
git diff --cached --check
```

Observed local result: the focused RPP-0338 regression reported 1 subtest with
0 failures. The adjacent generated-harness GUID/slug test, touched evidence
redaction scan, and whitespace checks returned exit code 0.

## Integration recommendation

Represent RPP-0338 as local support-only graph-identity evidence. It proves the
current generated harness carries ready and stale GUID/slug collision cases and
that planner/apply behavior remains fail-closed for stale remote identity
collisions.
