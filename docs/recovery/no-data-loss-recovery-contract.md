# No Data Loss Recovery Contract

The atomic apply path has three acceptable outcomes after a failure boundary:

- `old-remote`: nothing was committed to the remote site, and the recovery artifact explains why retry is safe.
- `fully-updated-remote`: every planned mutation is already present, so replay must stay read-only and return the completed journal artifact.
- `blocked-recovery`: the remote is partially advanced or drifted, and the result must carry recovery artifacts for inspection and fencing.

The important distinction is between lab evidence and durable production storage:

- Lab journals and model tests can prove the state machine and replay contract.
- Production recovery needs durable journal rows, fsync-backed file writes where applicable, fencing or lease protection around the writer, and a clear recovery artifact that survives process failure.
- The durable journal, not the in-memory replay fixture, must be able to explain why the remote is `old-remote`, `fully-updated-remote`, or `blocked-recovery` after restart.
- A partial remote mutation without a recovery artifact is a release blocker. If the code cannot prove one of the safe outcomes, it must stay blocked and expose inspectable artifacts instead of retrying blindly.
- A completed replay must stay read-only. Replaying a completed plan against a fully updated remote can return `fully-updated-remote`, but it must not duplicate inserts or resurrect stale local data.

If a retry cannot prove `old-remote` or `fully-updated-remote`, it must stay blocked rather than reapply mutations blindly.
