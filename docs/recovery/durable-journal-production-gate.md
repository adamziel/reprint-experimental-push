# Durable Journal Production Gate

The no-data-loss lane now has model coverage for these recovery states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

That proof is necessary, but it is not sufficient for release.

## Release blocker

Any partial remote mutation without a recovery artifact is a release blocker.

If an apply can leave the remote partially mutated and the system cannot
inspect or replay that state from durable storage, the lane must fail the
production gate.

## Durable storage requirements

Before release, the apply path must prove all of the following against a real
durable journal, not lab JSON or in-memory model state:

- journal rows are stored in durable DB or file-backed storage
- the journal survives process restart and replay inspection
- write ordering is protected by an fsync-equivalent durability boundary
- the writer is fenced by a lease or other single-writer mechanism
- plugin activation and dependency validation are recorded in the journal
- recovery inspection can classify the current remote from persisted artifacts

## Missing primitive

The current lane still lacks a production durable storage primitive that makes
the journal restart-readable and crash-safe. Until that exists, this lane can
only prove the recovery contract in model or lab storage.

## Acceptable post-failure states

After a failed apply, the remote must end up in exactly one of these states:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with durable artifacts

Anything else is an unacceptable recovery outcome.
