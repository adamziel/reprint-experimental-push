# No Data Loss Production Durable Journal Contract

This lane treats the apply boundary as safe only when the durable journal can
prove one of these outcomes after a restart:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

## Acceptable post-failure states

- `old-remote` means no remote mutation escaped the apply boundary.
- `fully-updated-remote` means the plan is already reflected and replay is
  inert.
- `blocked-recovery` means the remote may be partially updated or drifted, so
  recovery must stop and surface artifacts.

## Production requirement

The model tests can prove the state transitions, but production still needs a
durable journal that survives process exit and restart. That means:

- append-only journal rows or files
- flush or `fsync` behavior that reaches stable storage
- fencing or lease ownership around the writer
- restart-readable recovery inspection data
- no partial remote mutation without a durable recovery artifact

## Retry rules

Retrying must not:

- duplicate inserts
- resurrect stale local data
- treat a partial write as safe input

If the durable journal cannot prove a clean `old-remote` or `fully-updated-remote`
result, the retry must stay `blocked-recovery`.
