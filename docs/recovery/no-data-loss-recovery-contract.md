# No Data Loss Recovery Contract

The atomic apply path has three acceptable outcomes after a failure boundary:

- `old-remote`: nothing was committed to the remote site, and the recovery artifact explains why retry is safe.
- `fully-updated-remote`: every planned mutation is already present, so replay must stay read-only and return the completed journal artifact.
- `blocked-recovery`: the remote is partially advanced or drifted, and the result must carry recovery artifacts for inspection and fencing.
- `blocked-recovery` is also the correct result when a completed journal is replayed against a drifted remote and the replay cannot stay read-only.

The important distinction is between lab evidence and durable production storage:

- Lab journals and model tests can prove the state machine and replay contract.
- Production recovery needs durable journal rows, fsync-backed file writes where applicable, fencing or lease protection around the writer, and a clear recovery artifact that survives process failure.
- The durable journal, not the in-memory replay fixture, must be able to explain why the remote is `old-remote`, `fully-updated-remote`, or `blocked-recovery` after restart.
- A partial remote mutation without a recovery artifact is a release blocker. If the code cannot prove one of the safe outcomes, it must stay blocked and expose inspectable artifacts instead of retrying blindly.
- A completed replay must stay read-only. Replaying a completed plan against a fully updated remote can return `fully-updated-remote`, but it must not duplicate inserts or resurrect stale local data.
- The replay boundary is idempotent: a completed plan replay may only confirm the current remote state, never create a second copy of an inserted row or restore a stale local edit.
- If the completed remote has drifted, the replay must stop as `blocked-recovery` and keep both the journal and remote artifacts for inspection.

If a retry cannot prove `old-remote` or `fully-updated-remote`, it must stay blocked rather than reapply mutations blindly.

Failure boundaries covered by this contract:

- failure before mutation
- failure after staging
- failure after dependency validation
- replaying a completed plan

The first three boundaries must stay `old-remote`. A completed replay must stay
`fully-updated-remote`. If the remote drifts after completion, the replay must
fall back to `blocked-recovery` with artifacts instead of silently retrying.
