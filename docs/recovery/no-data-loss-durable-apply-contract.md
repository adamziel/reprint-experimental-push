# No Data Loss Durable Apply Contract

The durable apply boundary is only acceptable when it resolves to one of these post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Contract notes:

- Failures before mutation, after staging, and after dependency validation must remain `old-remote`.
- A completed replay must remain `fully-updated-remote` and must not stage new work.
- If the remote has advanced partially or drifted outside the journal envelope, the result must stay `blocked-recovery`.
- A partial remote mutation without a durable recovery artifact is a release blocker.
- Retry must not duplicate inserts or resurrect stale local data once the completed journal already proves the plan landed.

Production durability still requires restart-readable journal storage, flush or fsync semantics appropriate to the backend, and fencing or lease ownership so a stale writer cannot advance recovery state.
