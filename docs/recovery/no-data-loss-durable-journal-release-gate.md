# No Data Loss Durable Journal Release Gate

The no-data-loss lane currently proves the recovery boundary model in tests:

- failure before mutation
- failure after staging
- failure after dependency validation
- completed replay

Those proofs are necessary, but they are still not enough for release. The
production gate only passes when the same boundary is backed by durable storage
that survives restart and can be inspected after a crash.

## Acceptable post-failure states

After an apply failure, the remote must be in one of these states only:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable journal and remote artifacts

Any partial remote mutation without a recovery artifact is a release blocker.

## Missing durable primitives

The remaining production gap is the durable journal primitive itself:

- a real database row set or file-backed append log
- flush or `fsync`-equivalent durability on the journal path
- lease or fencing protection for the active writer
- restart-readable recovery inspection data

## Retry rules

Retries must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes without artifacts as safe

The model tests in this lane pin the state machine. Production release still
depends on the durable journal and crash-replay command that preserve the same
contract after process loss.
