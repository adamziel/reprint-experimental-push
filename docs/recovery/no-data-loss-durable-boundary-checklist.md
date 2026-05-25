# No Data Loss Durable Boundary Checklist

This lane treats the journal as the recovery source of truth, but the tests only
prove the model shape. Production still needs durable storage, restart-readable
artifacts, and fencing around the writer.

## Acceptable Results

An interrupted apply is only acceptable when it lands in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

## Failure Boundaries

The named pre-commit boundaries remain `old-remote` only:

- failure before mutation
- failure after staging
- failure after dependency validation

A completed replay remains `fully-updated-remote` only when it is inert.
If the replayed remote drifts, the result must be `blocked-recovery` with
inspectable journal and remote artifacts.

## Release Blocker

Any partial remote mutation without a durable recovery artifact is unsafe.
That includes retries that would otherwise treat a partial write as safe input.

## Production Requirements

The durable journal path still needs:

- journal rows or files that survive process exit
- fsync or an equivalent flush guarantee
- claim fencing or lease ownership for the active recovery writer
- restart-time inspection data that distinguishes old, fully updated, and blocked

