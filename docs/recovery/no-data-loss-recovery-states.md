# No Data Loss Recovery States

The atomic apply model is only acceptable when the post-failure state is one of
the following:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

## Why this matters

The test model in this lane uses JSON fixtures and temporary journal writers to
prove the state machine. That is enough to validate the recovery contract, but
it does not replace production durability.

## Failure boundaries

- Failure before mutation must keep the remote on `old-remote`.
- Failure after staging must keep the remote on `old-remote`.
- Failure after dependency validation must keep the remote on `old-remote`.
- Replaying a completed plan against a matching remote must remain
  `fully-updated-remote`.
- Replaying a completed plan against drift must become `blocked-recovery` and
  preserve the journal plus remote artifacts that explain the block.

## Release blocker

A partial remote mutation without a durable recovery artifact is unsafe.

Retries must not duplicate inserts, resurrect stale local data, or treat
partial writes without artifacts as safe.

## Production durability

Production recovery needs durable evidence that survives process failure:

- append-only journal rows or files
- flush or fsync semantics on the write path
- fencing or claim ownership so only one writer advances the journal
- restart-readable recovery metadata
- inspect tooling that can explain the recovered remote state after restart
