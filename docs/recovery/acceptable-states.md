# Recovery states for atomic apply

Atomic apply has three acceptable post-failure outcomes:

1. `old-remote`
   - Nothing visible changed on the remote.
   - Recovery evidence may exist, but the remote content still matches the pre-apply state.

2. `fully-updated-remote`
   - Every planned mutation is already visible on the remote.
   - Replay must be inert and must not duplicate inserts or reapply stale local data.

3. `blocked-recovery`
   - The remote cannot be classified safely from the journal alone.
   - Recovery must carry artifacts, including the journal and the observed remote snapshot.

The boundary rule is strict:

- A partial remote mutation without a recovery artifact is a release blocker.
- Retries must never treat partial writes as safe.
- Retries must never resurrect stale local data or duplicate inserts.

Durable journals should carry the evidence needed to inspect or resume after a crash:

- journal row or file state
- mutation target records
- completion or blocked markers
- enough metadata to classify the remote as old, fully updated, or blocked

JSON test fixtures and lab-only evidence are useful for proving the model, but they are not a substitute for durable journal storage with crash-safe writes, fsync or equivalent persistence, and recovery inspection on restart.

For production recovery, the journal itself is the source of truth for replay and inspection. A JSON snapshot can document the model, but it does not satisfy the no-data-loss contract unless the persisted journal records the boundary and recovery artifacts that classify the remote state.
