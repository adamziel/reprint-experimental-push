# Durable Journal Replay Boundary

This lane's no-data-loss contract is intentionally narrow:

- `old-remote` means the remote was not mutated and the journal artifact is still inspectable.
- `fully-updated-remote` means every planned mutation is already present, replay is inert, and retry must not duplicate inserts or resurrect stale local data.
- `blocked-recovery` means recovery cannot be completed safely and the failure must carry both remote and journal artifacts for inspection.

Accepted post-failure states are limited to:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with artifacts

The apply path should preserve that contract across these boundaries:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

Any partial remote mutation without a recovery artifact is a release blocker.

The durable journal is the source of recovery evidence. When a replay succeeds, it must be safe to retry and it must leave the remote byte-for-byte unchanged on the second pass. When a replay cannot be trusted, the result must be blocked recovery with inspectable artifacts rather than an optimistic success.
