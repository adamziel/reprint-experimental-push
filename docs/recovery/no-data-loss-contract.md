# No Data Loss Recovery Contract

This lane treats recovery as a three-state contract:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with preserved artifacts

## Failure boundaries

The allowed failure boundaries are:

- before mutation
- after staging
- after dependency validation
- after a completed plan has already been replayed

Across those boundaries, the system must never invent success. A failure may
leave the remote unchanged, may reveal that the remote is already fully
updated, or may block recovery with inspectable artifacts.

A partial remote mutation without a recovery artifact is a release blocker.

## Retry rules

Retries must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes without artifacts as safe

If a retry cannot explain the remote state from the durable journal and the
observed artifacts, it must stay blocked.

## Production note

The test suite in this lane uses JSON and temporary-file fixtures to prove the
state machine. Production recovery still needs durable journal storage, flushed
or fsynced writes, restart-readable inspection, and fencing so one writer owns
the journal advance.

If a partial remote mutation cannot be explained after restart, that is a
release blocker.
