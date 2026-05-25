# Durable Journal vs Lab Recovery Model

The recovery code in this lane proves the state machine with JSON fixtures, in-memory replay, and test-only inspect helpers.
That is useful for correctness, but it is not the same as a production-safe durable journal.

## Lab model

The test model can classify these outcomes:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

The lab model is allowed to use:

- JSON-backed fixtures
- synthetic replay journals
- in-memory mutation snapshots
- redacted evidence for tests

## Production requirements

A production recovery journal needs stronger guarantees:

- append-only durable writes
- fsync or equivalent persistence before the process reports success
- claim fencing or lease ownership so only one writer can advance recovery state
- restart-readable inspection records
- blocked recovery artifacts that survive a crash

## Release rule

A partial remote mutation without a durable recovery artifact is a release blocker.
Retry logic must not treat that state as safe input.

If recovery cannot prove the remote is `old-remote`, `fully-updated-remote`, or `blocked-recovery` with artifacts, the system must remain blocked.
