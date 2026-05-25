# Durable Apply Post-Failure Contract

`applyPlan()` has one recovery contract for durable journal failures:

- `old-remote`
  - The remote stayed unchanged.
  - The recovery record carries the journal artifact only.
  - This covers failure before mutation, after staging, and after dependency validation.

- `fully-updated-remote`
  - The plan completed and a replay is inert.
  - The recovery record carries the completed journal artifact only.
  - A completed replay must not duplicate inserts or resurrect stale local data.

- `blocked-recovery`
  - The remote is partially updated or the replay is no longer trustworthy.
  - The recovery record must preserve both the journal and the remote artifact.
  - Any partial remote mutation without a recovery artifact is a release blocker.

The recovery constructor rejects any post-failure shape outside those three
states so the code and tests agree on the same durable boundary.
