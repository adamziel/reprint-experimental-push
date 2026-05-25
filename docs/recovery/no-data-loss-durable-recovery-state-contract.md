# No-Data-Loss Durable Recovery State Contract

The durable apply path has three acceptable outcomes after an interruption:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with journal and remote artifacts

Any partial remote mutation that cannot be explained with a durable recovery
artifact is a release blocker.

## Boundary rules

- Failure before mutation must leave the remote unchanged and the journal in an
  inspectable pre-commit state.
- Failure after staging or after dependency validation must still classify as
  `old-remote` when the remote has not been mutated yet.
- A completed plan replay must remain inert. It may update durable journal
  evidence, but it must not duplicate inserts or resurrect stale local data.
- A stale completed replay against a drifted remote must be blocked instead of
  being treated as safe.

## Retry contract

Retries are only safe when the journal and current remote jointly prove one of
the accepted states above.

- `old-remote` means the remote still matches the pre-apply envelope.
- `fully-updated-remote` means the remote already matches the completed plan.
- `blocked-recovery` means replay cannot be proven safe and must stop with
  artifacts for inspection.

