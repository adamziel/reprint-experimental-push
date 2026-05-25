# Durable Recovery Release Blocker

The no-data-loss contract has three acceptable post-failure outcomes:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

Anything else is a release blocker.

## What Counts As Safe

- A failure before mutation, after staging, or after dependency validation must
  leave the remote at `old-remote`.
- A completed plan replay must remain inert and report `fully-updated-remote`.
- A stale completed replay or a partial apply must be `blocked-recovery` and
  must include journal and remote artifacts.

## Release-Blocker Rule

A partial remote mutation without a durable recovery artifact is not acceptable.
If the remote changed and the persisted recovery evidence cannot explain that
state after restart, the branch stays blocked.

## Lab Evidence Versus Production Durability

The test suite can prove the recovery state machine with JSON fixtures and
temporary files. Production recovery still needs:

- durable journal rows or files
- flush or fsync semantics
- restart-readable inspection
- fencing or lease ownership for a single writer

## Retry Safety

Retries must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes without artifacts as safe
