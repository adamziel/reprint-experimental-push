# No Data Loss Durable Journal Replay Boundary

The durable apply path must classify every outcome into one of three states:

- `old-remote`
  - Failure happened before any remote mutation escaped.
  - The journal may contain `opened`, `staged`, or `dependencies-validated`.
  - The remote artifact must remain absent.

- `fully-updated-remote`
  - The plan was already completed.
  - Replaying the same completed journal must be inert.
  - The remote artifact must remain absent.

- `blocked-recovery`
  - A partial remote mutation was observed or replay can no longer be trusted.
  - Durable artifacts must include both the journal and the remote snapshot.
  - This is the only acceptable state for a partial write.

Release gate:

- A partial remote mutation without a recovery artifact is a blocker.
- Retry must not duplicate inserts, resurrect stale local data, or treat partial writes as safe.
- Replay of a completed plan must return `fully-updated-remote` without fresh mutation work.
