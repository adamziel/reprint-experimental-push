# No Data Loss Accepted Post-Failure States

This lane treats the apply boundary as a durable journal boundary.

The only acceptable outcomes after an interrupted apply are:

1. `old-remote`
   - The remote remained untouched.
   - The journal may contain opened, staged, or dependency-validation evidence.
   - Retry is allowed only if it can preserve the same no-data-loss envelope.
2. `fully-updated-remote`
   - The plan finished or a completed plan replayed inertly.
   - Replay must not duplicate inserts or revive stale local data.
   - The durable journal remains inspectable.
3. `blocked-recovery`
   - The remote is partially applied, stale, or otherwise suspicious.
   - Recovery must stop and preserve both remote and journal artifacts for inspection.

A partial remote mutation without a recovery artifact is a release blocker.

The tests in `test/push-planner.test.js` prove the model envelope for:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan
- stale completed replay that must block instead of silently repairing drift

The remaining production gap is the durable storage primitive itself:

- journal rows or files that survive restart
- flush or fsync semantics on the write path
- claim fencing or lease ownership for stale writers
- restart-readable recovery inspection metadata
