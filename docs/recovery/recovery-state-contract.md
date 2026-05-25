# Recovery State Contract

The no-data-loss recovery path accepts only these post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

That contract is only safe when the journal is backed by durable storage.
In-memory replay evidence is useful for modeling, but it is not a release
boundary.

## Required production primitive

Before release, the apply path needs a real durable journal primitive:

- DB rows or a file-backed append log, not transient JSON objects
- `fsync` or an equivalent durability flush for the journal path
- lease or fencing ownership so stale writers cannot keep mutating
- recovery inspection that can restart from persisted artifacts

## Failure boundaries

- Failure before mutation must leave the remote unchanged.
- Failure after staging or dependency validation must still be recoverable from
  journal artifacts without exposing a partial remote mutation as safe.
- A completed plan replay must remain inert on retry and must not duplicate
  inserts or revive stale local data.
- A partial remote mutation without inspectable recovery artifacts is a release
  blocker.
