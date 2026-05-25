# No Data Loss Recovery Contract

This lane treats apply as a three-state outcome:

1. `old-remote`
   - No remote mutation is visible.
   - Recovery evidence may exist, but the remote contents still match the pre-apply state.

2. `fully-updated-remote`
   - Every planned mutation is visible on the remote.
   - Replay must stay inert and must not duplicate inserts or resurrect stale local data.

3. `blocked-recovery`
   - The remote cannot be classified safely.
   - Recovery must carry artifacts that explain the state, especially the journal and any observed remote snapshot.

Acceptable failure outcomes are limited to these states. A partial remote mutation without recovery artifacts is a release blocker.

## Durable journal expectations

The durable journal is the on-disk recovery evidence, not just an in-memory test fixture.
It should preserve enough information to answer:

- which plan was being applied,
- what boundary was last crossed,
- whether the remote is still old, fully updated, or blocked,
- and what artifact path should be used for recovery inspection.

If a failure happens before mutation, after staging, or after dependency validation, the recovery state must still classify as `old-remote` and preserve journal artifacts.

If a completed plan is replayed, the recovery state must classify as `fully-updated-remote` and remain inert.

