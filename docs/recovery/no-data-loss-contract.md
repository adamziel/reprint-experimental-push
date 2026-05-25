# No Data Loss Recovery Contract

This lane treats recovery as a first-class state machine, not just a best-effort
retry path.

## Acceptable Post-Failure States

After an apply attempt, the remote must end up in one of these states:

1. `old-remote`
   - No remote mutation became durable.
   - Recovery artifacts are present.
   - The journal explains why the apply stopped before commit.
2. `fully-updated-remote`
   - Every planned mutation is already present.
   - Recovery artifacts are present.
   - A completed replay must stay inert and must not duplicate inserts.
3. `blocked-recovery`
   - The remote may be partially updated or drifted.
   - Recovery artifacts are present.
   - The blocked state must preserve inspectable journal evidence and any
     necessary remote snapshot evidence.

## Recovery Rule

A partial remote mutation without recovery artifacts is a release blocker.

Retries must not:

- duplicate inserts,
- resurrect stale local data,
- or classify a partial write as safe without recovery evidence.

## Boundary Coverage

The test matrix in `test/push-planner.test.js` covers:

- failure before mutation,
- failure after staging,
- failure after dependency validation,
- completed replay,
- stale completed replay,
- and blocked partial recovery.

