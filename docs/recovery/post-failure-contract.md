# Post-Failure Recovery Contract

This lane treats no data loss as a hard constraint.

After any failed or interrupted apply, the system must land in exactly one of these states:

1. `old-remote`
   - The remote stayed unchanged.
   - The recovery journal is present and inspectable.
   - No remote artifact is attached because no mutation reached the target.

2. `fully-updated-remote`
   - Every planned mutation is already present on the remote.
   - The recovery journal is present and inspectable.
   - Replay is inert and must not duplicate inserts or resurrect stale local data.

3. `blocked-recovery`
   - The remote may be partially mutated, but only if recovery artifacts are attached.
   - The recovery journal is present and inspectable.
   - The remote artifact must describe the observed remote state that made the retry unsafe.

Anything else is a release blocker.

In particular:

- A partial remote mutation without a recovery artifact is not acceptable.
- A retry must not duplicate inserts.
- A retry must not treat stale local data as current.
- A stale completed replay must block rather than pretending drift is safe.

The tests in `test/push-planner.test.js` pin the current boundaries for:

- failure before mutation
- failure after staging
- failure after dependency validation
- mid-apply failure
- replaying a completed plan
- stale completed replay
