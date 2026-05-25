# No Data Loss Post-Failure State Contract

The atomic apply path only accepts three post-failure outcomes:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery`

The contract is intentionally narrow:

- `old-remote` is valid for failures before any remote mutation.
- `fully-updated-remote` is valid only after the plan has replayed or committed every mutation.
- `blocked-recovery` is valid only when the remote may be partially updated and the failure artifacts preserve both the journal and the remote snapshot.

Anything else is a release blocker.

Replay rules:

- Replaying a completed plan must be inert.
- A completed replay must keep the remote unchanged.
- A completed replay must return `fully-updated-remote` with a completed journal artifact only.
- Retrying a blocked partial apply must not duplicate inserts or resurrect stale local data.

Durability boundary notes:

- Failure before mutation should leave the remote at `old-remote`.
- Failure after staging or after dependency validation should still report `old-remote` because the remote has not been mutated yet.
- Failure during commit must surface `blocked-recovery` with inspectable artifacts.
