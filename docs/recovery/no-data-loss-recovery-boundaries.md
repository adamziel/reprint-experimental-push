# No Data Loss Recovery Boundaries

This note captures the recovery contract used by the no-data-loss lane.
It is intentionally narrower than the broader invariants docs so reviewers can
check the failure boundaries and the durable-journal expectation quickly.

## Acceptable post-failure states

Every interrupted apply must land in exactly one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

A partial remote mutation without inspectable recovery artifacts is a release
blocker.

## Failure boundaries

The recovery model must stay stable across these boundaries:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

The first three boundaries must leave the remote on the old side of the apply
and preserve the recovery journal. A completed-plan replay must be inert and
must not duplicate inserts or resurrect stale local data.

## Durable journal requirement

The JSON fixtures in tests are proof artifacts only. Production recovery still
needs durable storage behavior:

- append-only journal writes that survive process exit
- fsync or equivalent flush semantics
- writer fencing or lease ownership
- inspectable recovery metadata after restart

If the journal cannot explain a visible remote mutation, recovery stays
blocked until the artifact set is complete.
