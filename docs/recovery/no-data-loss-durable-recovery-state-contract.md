# No Data Loss Durable Recovery State Contract

This lane treats atomic apply as safe only when every interrupted run lands in one of three outcomes:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with recovery artifacts attached

Anything else is a release blocker.

The durable journal boundary should prove these transitions at the executable apply path:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan from a durable journal

## Required failure shape

A failure during apply must not leave the remote partially mutated without a recovery artifact.

The acceptable aftermath is:

- the remote is unchanged (`old-remote`)
- the remote is fully updated and replay is inert (`fully-updated-remote`)
- the apply is blocked and the recovery record carries both journal evidence and the current remote snapshot (`blocked-recovery`)

## Retry rules

- Retrying a completed plan must not reapply mutations.
- Retrying must not duplicate inserts.
- Retrying must not resurrect stale local data that is already superseded by the remote state.
- A partial write without recovery artifacts is not safe to retry.
- A completed-plan replay must stay inert and must not duplicate inserts or revive stale local data.

## Boundary evidence

The test matrix in `test/push-planner.test.js` should keep proving these boundaries:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan
- blocked partial recovery

The durable journal implementation should preserve these states with append-only evidence, not just in-memory test fixtures.
