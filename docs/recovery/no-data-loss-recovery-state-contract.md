# No Data Loss Recovery State Contract

The atomic apply path must end in one of three states:

1. `old-remote`
   - The remote was not mutated.
   - Recovery artifacts must include the journal.
   - The remote artifact must remain absent.

2. `fully-updated-remote`
   - All planned mutations were applied.
   - Recovery artifacts must include the journal.
   - The remote artifact must remain absent.

3. `blocked-recovery`
   - The apply or replay path detected a partial, drifted, or otherwise unsafe state.
   - Recovery artifacts must include both the journal and the inspected remote snapshot.
   - The state is not safe to treat as a completed apply.

Retry behavior must preserve these constraints:

- A completed replay stays inert and does not reapply mutations.
- A partial write without recovery artifacts is a release blocker.
- Retry must not duplicate inserts or resurrect stale local data.

This contract is enforced by the recovery-oriented planner tests in `test/push-planner.test.js`.
