# No Data Loss Production Durable Journal Checklist

The recovery tests in this lane prove the state machine. Production still needs
durable artifacts that survive process restart.

## Required proof

- Failure before mutation, after staging, and after dependency validation must
  remain `old-remote`.
- Replaying a completed plan must remain `fully-updated-remote`.
- Partial or ambiguous apply results must become `blocked-recovery` and carry
  inspectable journal plus remote artifacts.

## Production durability expectations

- Journal rows or files must be append-only and restart-readable.
- Writes must be flushed or fsynced according to the storage backend.
- One writer must own the journal advance through fencing, lease, or ownership
  controls.
- Recovery inspection must be able to explain the remote state after restart.

## Release blocker

Any partial remote mutation without a durable recovery artifact is unsafe.
Retries must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes without artifacts as safe

This checklist complements the deeper recovery contract docs in this directory.
