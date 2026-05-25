# Acceptable Post-Failure States

The atomic apply model only allows three outcomes after a failure or retry:

1. `old-remote`
   - No remote mutation happened.
   - The durable journal still records the attempted plan and the recovery
     boundary.
   - Retry is only safe if it replays from the original remote snapshot.

2. `fully-updated-remote`
   - Every planned mutation is already present on the remote.
   - A completed journal may be replayed without mutating the remote again.
   - Retry must not duplicate inserts or revive stale local data.

3. `blocked-recovery`
   - A partial mutation escaped the current attempt and cannot be treated as
     safe.
   - The recovery artifact must include both remote and journal evidence.
   - Retry must inspect the artifacts instead of assuming the remote is safe.

Any partial remote mutation without a recovery artifact is a release blocker.

Completed-plan replay is not a fourth post-failure state. It is a
`fully-updated-remote` replay that must stay inert, preserve the existing
remote, and avoid duplicating inserts or resurrecting stale local data.
