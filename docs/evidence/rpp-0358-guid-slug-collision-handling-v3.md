# RPP-0358 GUID and slug collision handling variant 3 evidence

Date: 2026-05-31
Lane: RPP-0358 GUID and slug collision handling, variant 3
Checklist item: RPP-0358 - Add generated coverage for GUID and slug collision
handling, variant 3.
Success text: generated harness includes ready and stale cases.
Final release posture: `NO-GO`

## Scope

This is local generated-harness graph-identity support evidence. It adds only
the focused RPP-0358 regression test and this evidence note. It does not edit
generated harness sources, release verifier code, shared progress surfaces,
checklist files, or production release status.

## Proof surface

- `test/rpp-0358-guid-slug-collision-handling-v3.test.js` filters the existing
  generated push harness for `post-guid-slug-collision-guard`.
- The target emits 20 deterministic cases: one ready unique GUID/slug page row
  and one stale remote identity collision row for each tier 0 through 9.
- Ready cases plan and apply the unique page row, carry a live remote
  precondition, and reject stale replay with `PRECONDITION_FAILED`.
- Stale cases keep the colliding remote page row, block the local page row as
  `stale-wordpress-graph-identity`, emit `wp_posts.identity` /
  `post-natural-identity-collision` evidence, and refuse apply with
  `PLAN_NOT_READY` before mutation.
- The aggregate proof is deterministic and hash-only. It records resource keys,
  status counts, identity-kind labels, SHA-256 hashes, refusal codes, and a
  proof hash. Raw generated titles, GUIDs, and slugs are asserted absent.

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
  "staleCases": 10,
  "releaseGate": "NO-GO",
  "productionBacked": false
}
```

Invariant summary:

```json
{
  "readyUniquePostMutation": true,
  "staleCollisionBlockerClass": "stale-wordpress-graph-identity",
  "collisionRelationshipType": "post-natural-identity-collision",
  "collisionIdentityKinds": [
    "guid",
    "post_type+post_name"
  ],
  "staleApplyRefusalCode": "PLAN_NOT_READY",
  "readyStaleReplayRefusalCode": "PRECONDITION_FAILED"
}
```

## Validation commands

```sh
node --check test/rpp-0358-guid-slug-collision-handling-v3.test.js
node --test --test-name-pattern RPP-0358 test/rpp-0358-guid-slug-collision-handling-v3.test.js
node --test --test-name-pattern RPP-0378 test/rpp-0378-guid-slug-collision-handling-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0358-guid-slug-collision-handling-v3.md
git diff --check
git diff --cached --check
```

Observed local result: syntax check exited 0; the focused RPP-0358 test
reported 1 subtest with 0 failures; the adjacent RPP-0378 test reported 1
subtest with 0 failures; artifact redaction scan returned `ok: true`; and both
whitespace diff checks exited 0.

## Integration recommendation

Represent RPP-0358 as local support-only graph-identity evidence. It proves the
current generated harness includes ready and stale GUID/slug collision cases and
that planner/apply behavior remains fail-closed for stale remote natural
identity collisions. Release posture remains `NO-GO`.
