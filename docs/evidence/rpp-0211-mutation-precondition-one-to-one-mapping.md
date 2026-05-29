# RPP-0211 mutation/precondition one-to-one mapping

Status: validated locally on 2026-05-29 for variant 1. Release remains gated by the broader integration lane.

## Proof surface

- Focused planner fixture: a ready mixed-resource plan (file, core row, and allowlisted plugin-owned option row) emits exactly one `live-remote` precondition per mutation.
- Focused executor fixture: forged ready plans with missing, duplicate, orphaned, resource-key-mismatched, resource-object-mismatched, hash-mismatched, or non-live-remote preconditions fail before mutation with `PLAN_INVARIANT_VIOLATION`.
- Generated fixture proof: every deterministic generated push case maps each mutation id to one precondition and maps each precondition back to one mutation with the same resource key, resource object, remote-before hash, live remote hash, and `live-remote` marker.

## Validation

```sh
node --test --test-name-pattern=RPP-0211 test/push-planner.test.js test/generated-push-harness.test.js
```

Result: 3 tests passed.

## Caveat

This is local deterministic Node evidence over focused and generated fixtures. It does not publish progress or change release status by itself.
