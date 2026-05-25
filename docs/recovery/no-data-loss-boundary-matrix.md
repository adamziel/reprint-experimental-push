# No Data Loss Boundary Matrix

This lane treats atomic apply as safe only when every interruption lands in one
of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

Failure boundaries and expected recovery outcomes:

| Boundary | Accepted outcome | Required artifacts |
| --- | --- | --- |
| Before mutation | `old-remote` | Recovery journal evidence |
| After staging | `old-remote` | Recovery journal evidence |
| After dependency validation | `old-remote` | Recovery journal evidence |
| Completed plan replay | `fully-updated-remote` | Completed journal replay evidence |
| Partial or ambiguous mutation | `blocked-recovery` | Recovery journal plus remote inspection artifacts |

Safety rules:

- A partial remote mutation without a recovery artifact is a release blocker.
- Retry must not duplicate inserts.
- Retry must not resurrect stale local data.
- A replayed completed plan is inert; it can confirm the fully updated remote
  state, but it must not reapply mutations.

Production recovery still needs durable storage semantics. The JSON model and
tests prove the boundary contract, but the production system needs durable
journal rows or files, fsync-backed persistence, plugin activation state in the
journal, leases or fencing, and inspectable recovery artifacts for blocked
cases.

In other words:

- lab JSON evidence can prove the state machine
- production durability must prove the same states after process exit
- a partial remote mutation without a durable recovery artifact remains a
  release blocker even if the lab model classifies it as recoverable
