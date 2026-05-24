# Durable Journal Recovery Model

The atomic apply path has three acceptable outcomes after any interruption:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with inspectable artifacts

## Boundary contract

The apply flow must never leave behind a partially mutated remote without a recovery artifact. If a write stops:

- before mutation
- after staging
- after dependency validation
- during replay of a completed plan

then the remote must still be classifiable as one of the documented states above.

## What each state means

- `old-remote`: the remote still matches the pre-apply state. The journal may show the opened, staged, or dependency-validated envelope, but the remote itself is unchanged.
- `fully-updated-remote`: every planned mutation is already present, and replay is inert.
- `blocked-recovery`: recovery cannot proceed automatically because the remote drifted outside the before/after envelope or a partial commit was observed. This state must include journal artifacts, and for partial commits it must also include remote artifacts for inspection.

## Production vs lab evidence

JSON fixtures and test-only inspection helpers are useful for proving the model, but they are not a substitute for a durable recovery journal in production.

Production recovery needs durable storage semantics:

- appended journal rows or records
- fsync or equivalent persistence guarantees
- plugin activation state captured in the journal
- claim fencing or leases for concurrent writers
- inspectable artifacts for blocked recovery

If any of those are missing, a partial remote mutation without artifacts is a release blocker.
