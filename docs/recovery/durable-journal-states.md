# Durable Journal Recovery States

The apply path must only leave the remote in one of three acceptable states after a failure or replay boundary:

1. `old-remote`
   - No target mutation has been committed.
   - The journal may be open, staged, or dependency-validated, but the remote remains unchanged.
   - Recovery must be able to replay from the journal without duplicating inserts or reviving stale local data.

2. `fully-updated-remote`
   - Every planned mutation has been committed.
   - The journal is completed and can be replayed inertly.
   - Replaying a completed plan must not mutate the remote again.

3. `blocked-recovery`
   - The remote drifted or the journal cannot prove a safe finish.
   - Both journal artifacts and remote artifacts must be present so the operator can inspect the blocked state.
   - This is a release blocker for any partial mutation that lacks recovery artifacts.

Failure points that matter for the release gate:

- before mutation
- after staging
- after dependency validation
- completed-plan replay

The recovery boundary is acceptable only when every failure path resolves to one of the states above and never produces a partial remote mutation without artifacts.
