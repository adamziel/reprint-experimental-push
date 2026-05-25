# Recovery States

The no-data-loss recovery contract allows only three post-failure outcomes:

1. `old-remote`
   - No remote mutation should be visible.
   - Recovery artifacts must include the durable journal.
   - The journal may describe the plan, staged boundaries, and why the apply stopped.

2. `fully-updated-remote`
   - All planned mutations are already present on the remote.
   - Recovery artifacts must include the durable journal.
   - Replay must be inert and must not duplicate inserts or reintroduce stale local data.

3. `blocked-recovery`
   - The remote was partially mutated and cannot be trusted as safe.
   - Recovery artifacts must include both the durable journal and the drifted remote snapshot.
   - Retry is only acceptable if it preserves the blocked state and keeps the artifacts available for inspection.

## Durable Journal Requirements

The journal is the durable source of recovery evidence. It must survive process failure and carry enough information to distinguish:

- failure before any mutation,
- failure after staging,
- failure after dependency validation,
- completed replay,
- stale completed replay,
- and blocked partial recovery.

The journal should be backed by durable storage, not just in-memory or lab-only evidence. In production that means the journal row or file must be written durably before the apply is considered recoverable.

## What Counts As A Blocker

A partial remote mutation without a recovery artifact is a release blocker.

If recovery cannot explain the remote state from the durable journal, the result must not be treated as safe.
