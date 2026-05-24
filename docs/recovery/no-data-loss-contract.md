# No Data Loss Recovery Contract

This lane treats the atomic apply path as a recoverable journaled operation.

## Acceptable Post-Failure States

After any injected or durable failure, the system must land in one of these states:

1. `old-remote`
   - No remote mutation is committed.
   - The recovery artifact explains why the apply stopped.

2. `fully-updated-remote`
   - Every planned mutation is already present.
   - Replaying the same completed plan is idempotent and must not duplicate inserts or resurrect stale local data.

3. `blocked-recovery`
   - The remote may be partially updated.
   - The recovery artifact must include the journal and any safe remote snapshot needed for inspection.

## Apply-Phase Expectations

The atomic apply flow is intentionally bounded at three failure edges:

- Before any mutation is staged, the remote must remain `old-remote`.
- After staging but before commit, the remote must still be `old-remote` and the journal must explain the interruption.
- After dependency validation, the same rule applies: no partial remote mutation is acceptable without artifacts.
- If a completed plan is replayed against the already-updated remote, the result must be `fully-updated-remote` and the replay must stay inert.

## Recovery Rules

- A partial remote mutation without a recovery artifact is a release blocker.
- Retrying with a completed journal must be a no-op for already-applied mutations.
- Retry logic must refuse to treat drifted state as fresh local data.
