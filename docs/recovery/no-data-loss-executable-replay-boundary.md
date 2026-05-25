# No Data Loss Executable Replay Boundary

This lane already enforces the recovery state whitelist for interrupted apply runs:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with journal and remote artifacts

That contract is only safe if the durable journal and replay path keep the
state machine observable across restart boundaries.

## What counts as safe

- Failure before mutation leaves the remote unchanged and records an
  `old-remote` recovery state.
- Failure after staging or dependency validation still leaves the remote
  unchanged and must not hide the journal artifact.
- A completed plan may be replayed, but replay must be inert and must not
  duplicate inserts or resurrect stale local data.
- A drifted completed replay must fall back to `blocked-recovery` with the
  remote snapshot and journal artifact attached.

## Release blocker

Any partial remote mutation without an inspectable recovery artifact remains a
release blocker.

If a recovery journal cannot be read back from durable storage, the apply path
must stay blocked instead of pretending the remote is safe to reuse.
