# Durable Apply Release Blockers

This lane treats atomic apply as safe only when the post-failure outcome is one of:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Any partial remote mutation without a durable recovery artifact is a release blocker.

## Acceptable outcomes

- `old-remote`: no target mutation became durable, and the journal explains the interruption point.
- `fully-updated-remote`: every planned mutation is already present, and replay stays inert.
- `blocked-recovery`: the remote is partially or ambiguously updated, and recovery carries the journal plus remote artifacts needed for inspection.

## Invariants

- Failure before mutation, after staging, and after dependency validation must remain explainable as `old-remote`.
- Completed replay must not duplicate inserts.
- Completed replay must not resurrect stale local data.
- A blocked recovery must keep inspectable artifacts attached.

## Operational note

This document separates the recovery contract from the storage backend details. Production recovery still needs:

- durable journal rows or files that survive restart,
- flush or fsync semantics appropriate to the backend,
- claim fencing or lease handling for concurrent writers,
- recovery inspection that can distinguish old remote, fully updated remote, and blocked partial recovery.
