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

## Recovery Rules

- A partial remote mutation without a recovery artifact is a release blocker.
- Retrying with a completed journal must be a no-op for already-applied mutations.
- Retry logic must refuse to treat drifted state as fresh local data.

