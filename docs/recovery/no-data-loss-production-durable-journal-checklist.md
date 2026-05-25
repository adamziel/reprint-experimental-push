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

- Journal rows or files must be append-only, restart-readable, and durable
  enough to survive process exit.
- Writes must be flushed, fsynced, or committed according to the storage
  backend before a partial apply can be treated as recoverable.
- One writer must own the journal advance through fencing, lease, or ownership
  controls so a stale writer cannot race recovery.
- Recovery inspection must be able to classify the remote as `old-remote`,
  `fully-updated-remote`, or `blocked-recovery` after restart.
- The blocked state must preserve both the journal artifact and the remote
  artifact so an operator can explain the partial write.

## Release blocker

Any partial remote mutation without a durable recovery artifact is unsafe.
Retries must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes without artifacts as safe

This checklist complements the deeper recovery contract docs in this directory.
