# RPP-0231 mutation/precondition one-to-one mapping v2

Status: focused and generated Node proofs validated locally on 2026-05-30 for variant 2. Release remains NO-GO.

## Scenario

The focused planner proof covers ready, conflict, and blocked atomic propagation fixtures. For every emitted mutation, it asserts exactly one live-remote precondition with the same mutation id, resource key, resource object key, remote-before hash, live remote hash, and `live-remote` marker. It also asserts every precondition maps back to one emitted mutation, and forged extra preconditions fail before durable journal or mutation evidence.

The generated harness contract now applies the same one-to-one mutation/precondition invariant to every deterministic generated case. Atomic group propagation blockers are treated as group-level apply blockers that may reference emitted grouped mutations; direct conflict and direct blocker resources still cannot also have mutations.

## Commands and caveat

```sh
node --test --test-name-pattern=RPP-0231 test/push-planner.test.js
node --test --test-name-pattern=RPP-0231 test/generated-push-harness.test.js
```

Caveat: this is a local deterministic Node proof over focused and generated fixtures. Release remains gated separately by the full checklist and CI evidence.
