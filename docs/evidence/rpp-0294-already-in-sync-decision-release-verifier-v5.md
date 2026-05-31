# RPP-0294 already-in-sync decision release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0294 already-in-sync decision release-verifier carry-through, variant 5
Checklist item: RPP-0294 — Carry through the release verifier for already-in-sync decision, variant 5.

## Scope

This adds focused local release-verifier support evidence for the
`already-in-sync` merge decision. The proof is support-only and productionBacked
`false`; it does not broaden the live production release boundary.

## Proof surface

`test/rpp-0294-already-in-sync-decision-release-verifier-v5.test.js` builds a
focused fixture where local and remote independently converge on identical
delete, create, and update states across file, plugin metadata, `wp_options`,
and `wp_posts` resources. The same fixture includes one unrelated local file
mutation so apply behavior can prove decision resources stay untouched.

The test verifies that:

- the focused plan is ready with one mutation, five `already-in-sync`
  decisions, and one live-remote precondition for only the unrelated mutation;
- every synchronized decision resource is mutation-free and precondition-free;
- a clean apply leaves the synchronized resources on their remote hashes;
- post-plan remote drift on all decision resources is preserved while the
  unrelated mutation applies;
- forged ready plans that add overlapping mutations for decision resources are
  refused with `MUTATION_DECISION_RESOURCE_OVERLAP` before durable journal
  writes or remote mutation; and
- deterministic generated harness cases tagged `already-in-sync` still produce
  decision-only resources with no mutation or precondition overlap.

The release-verifier evidence envelope follows the RPP-0291 support-only shape:
it records the command, NO-GO release posture, deterministic replay hashes,
focused and generated aggregate hashes, and hash-only redaction metadata.

## Focused verification observed locally

```sh
node --check test/rpp-0294-already-in-sync-decision-release-verifier-v5.test.js
node --test test/rpp-0294-already-in-sync-decision-release-verifier-v5.test.js
node --test test/rpp-0254-already-in-sync-decision-v3.test.js test/rpp-0274-already-in-sync-decision-v4.test.js test/rpp-0291-mutation-precondition-one-to-one-release-verifier-v5.test.js
node --test --test-name-pattern='already-in-sync|RPP-0214|RPP-0234|RPP-0254|RPP-0274|RPP-0294' test/push-planner.test.js test/rpp-0234-already-in-sync-decision-v2.test.js test/rpp-0254-already-in-sync-decision-v3.test.js test/rpp-0274-already-in-sync-decision-v4.test.js test/rpp-0294-already-in-sync-decision-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0294-already-in-sync-decision-release-verifier-v5.md docs/scenario-matrix.md
git diff --check
```

Observed result after validation: all commands exited 0. The focused RPP-0294
test reported 2 subtests ok, 0 failed. The adjacent RPP-0254/RPP-0274/RPP-0291
suite reported 3 subtests ok, 0 failed. The adjacent already-in-sync planner
slice reported 6 subtests ok, 0 failed. The scoped artifact redaction scan
returned `"ok": true` for the touched docs.

## Release posture

This is local release-verifier support evidence only. The emitted proof is
hash-only and explicitly productionBacked `false`; final release remains NO-GO
until live production-backed proof satisfies the broader release boundary.
