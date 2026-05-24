# No Data Loss Release Blocker

The atomic apply boundary is only safe when the recovery story is explicit.

Acceptable post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Anything else is a release blocker.

## Release-blocker rule

A partial remote mutation without a durable recovery artifact is never
acceptable. If the remote changed and the persisted journal cannot explain the
state, the branch must stay blocked until recovery evidence is written or the
mutation is rolled back.

## Production requirement

Lab JSON fixtures can prove the model, but production recovery needs durable
journal rows or files, crash-safe persistence, and restart-readable inspection.
The persisted journal must be able to explain why the remote is old, fully
updated, or blocked after a restart.

## Retry rule

Retries must not:

- duplicate inserts
- resurrect stale local data
- treat a partial write as safe

