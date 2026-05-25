# No Data Loss Durable Journal Contract

The no-data-loss lane treats atomic apply as safe only when every failure boundary lands in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable journal plus remote artifacts

That contract is intentionally strict:

- Failure before mutation must leave the remote untouched and record an `old-remote` journal artifact.
- Failure after staging must still leave the remote untouched and record an `old-remote` journal artifact.
- Failure after dependency validation must still leave the remote untouched and record an `old-remote` journal artifact.
- A completed replay must stay read-only and report `fully-updated-remote`.
- A stale or partial replay must block recovery and preserve both journal and remote artifacts.

Release blocker:

- A partial remote mutation without a durable recovery artifact is unsafe.
- Retry logic must not treat partial writes as safe input, duplicate inserts, or resurrect stale local data.

Model versus production:

- The tests use in-memory JSON and ephemeral files to prove the state machine.
- Production still needs durable journal storage, flush/fsync semantics, fencing or lease ownership, and restart-readable recovery inspection data.
