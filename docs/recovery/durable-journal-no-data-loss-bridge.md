# Durable Journal and No Data Loss

The recovery model in this lane is intentionally strict:

- `old-remote` is acceptable only when the remote has not been committed yet and the journal explains where execution stopped.
- `fully-updated-remote` is acceptable only when replay is inert and the completed journal proves every planned mutation already landed.
- `blocked-recovery` is acceptable only when the remote is partially or ambiguously mutated and the recovery bundle includes both journal and remote artifacts.

This is the bridge between the in-memory test model and production recovery:

- The lab tests prove the shape of the recovery state.
- Production still needs durable journal rows or files, fsync semantics, and fencing or lease protection so a partial write cannot be treated as safe.

Release rule:

- Any partial remote mutation without an inspectable recovery artifact is a blocker.
- Retry must not duplicate inserts, resurrect stale local data, or silently treat a partial write as old-remote.
