# No Data Loss Durable Recovery: Production Boundary

This lane treats the recovery model as correct only when the failure boundary
lands in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

The model tests prove the state machine shape, not the production durability
mechanism.

## What the tests prove

- Failure before mutation stays `old-remote`.
- Failure after staging stays `old-remote`.
- Failure after dependency validation stays `old-remote`.
- A completed replay stays `fully-updated-remote` and remains inert.
- A stale or partial replay stays `blocked-recovery` and keeps inspectable
  artifacts.

## What production still needs

The release is not safe unless the durable journal survives the crash boundary
and can be inspected after restart. That means:

- durable journal rows or files, not just in-memory JSON
- flush or fsync behavior that actually reaches stable storage
- fencing or lease ownership around apply
- restart-readable recovery inspection data
- no partial remote mutation without a durable recovery artifact

## Release blocker

A partial remote mutation without a recovery artifact is unsafe.

Retry logic must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes as safe input

The lab fixtures and JSON evidence are useful for modeling the contract, but
they do not replace restart-safe production recovery.
