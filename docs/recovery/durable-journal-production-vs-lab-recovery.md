# Durable Journal Production vs Lab Recovery

The no-data-loss tests in this lane use JSON fixtures, temporary files, and
in-memory stubs to model recovery behavior. That is enough to prove the
contract, but it is not enough to claim production durability.

## Lab recovery evidence

Lab evidence is valid when it shows:

- `old-remote` after failure before mutation, after staging, or after dependency validation
- `fully-updated-remote` when a completed plan is replayed inertly
- `blocked-recovery` when a partial or ambiguous remote needs inspection

Lab fixtures are allowed to be synthetic because the point is to prove the
state machine, not the persistence backend.

## Production recovery requirements

Production recovery needs durable artifacts that survive process failure:

- append-only journal rows or files, not just in-memory test logs
- flush or fsync semantics on the write path
- restart-readable state for recovery inspection
- fencing or claim ownership so one writer controls the journal advance
- a stable inspection path that can explain the exact remote state after restart

Concrete production surfaces include:

- database rows for journal and recovery-state records
- fsynced files or file-backed journals with durable append ordering
- plugin activation or lease records that fence concurrent writers
- recovery inspect tooling that can read the persisted artifacts after a crash

If the remote mutated and the journal cannot explain it after restart, that is a
release blocker.

## Retry safety

Retries must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes without artifacts as safe
