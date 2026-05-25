# Durable Apply Recovery

This lane models the recovery contract for `applyPlan()` with durable journals.

Accepted post-failure states are limited to:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The important operational rule is narrower than the model evidence:

- A partial remote mutation without a durable recovery artifact is a release blocker.
- Retry must not duplicate inserts or resurrect stale local data.
- A completed plan may be replayed against the same remote, but the replay must remain inert.

The model tests in `test/push-planner.test.js` prove the recovery envelope for:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

Production durability still needs the usual hard guarantees from the runtime layer:

- journal rows persisted durably
- file writes fsynced where required
- plugin activation state fenced correctly
- blocked recovery artifacts preserved for inspection
