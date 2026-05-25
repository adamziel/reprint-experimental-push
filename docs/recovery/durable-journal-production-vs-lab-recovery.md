# Durable Journal Production vs Lab Recovery

The no-data-loss tests in this lane use JSON fixtures, temporary files, and
in-memory stubs to model recovery behavior. That is enough to prove the
contract, but it is not enough to claim production durability.

## Lab recovery evidence

Lab evidence is valid when it shows:

- `old-remote` after failure before mutation, after staging, or after dependency validation
- `fully-updated-remote` when a completed plan is replayed inertly
- `blocked-recovery` when a partial or ambiguous remote needs inspection

The lab model is intentionally narrow. It only needs to prove that each failure
boundary lands in one of those three states and that retries do not duplicate
inserts or revive stale local data.

Lab fixtures are allowed to be synthetic because the point is to prove the
state machine, not the persistence backend.

The model evidence is still useful as a release gate because it proves the
boundary contract that production must preserve:

- failure before mutation, after staging, and after dependency validation stay `old-remote`
- replay of a completed plan stays `fully-updated-remote`
- stale completed replay stays `blocked-recovery` with inspectable artifacts
- any partial or ambiguous mutation must stay `blocked-recovery` with artifacts
- a partial remote mutation without a durable recovery artifact is a release blocker

This lane still fails the production gate until the apply path is backed by a
real crash-safe durable journal primitive: append-only DB rows or file-backed
journal records, fsync or equivalent flush semantics, writer fencing or lease
ownership, and restart-readable inspection data. The JSON model proves the
state machine only; it does not supply that storage primitive yet.

The exact missing production primitive is a durable journal that survives
process death and restart, not just a lab fixture:

- append-only DB rows or file-backed journal records
- fsync or backend-equivalent flush semantics before the write is considered durable
- writer fencing, lease ownership, or equivalent exclusion so stale retries cannot advance recovery
- restart-readable recovery inspection that can explain partial writes after a crash

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

The acceptable post-failure states are still the same in production:

- `old-remote` when nothing was durably committed yet
- `fully-updated-remote` when replay proves the remote already matches the plan
- `blocked-recovery` when the remote has partial or ambiguous evidence and the
  recovery artifacts are preserved for inspection

Anything else is an unsafe gap between the mutation path and the recovery path.

## Retry safety

Retries must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes without artifacts as safe
