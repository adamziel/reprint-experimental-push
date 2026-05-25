# Recovery states

The atomic apply path should only ever end in one of these post-failure states:

- `old-remote`: no mutation reached the remote state.
- `fully-updated-remote`: every planned mutation is already present and a replay is safe.
- `blocked-recovery`: a partial or drifted remote was observed and recovery artifacts must be preserved.

Rules:

- A partial remote mutation without recovery artifacts is a release blocker.
- Retry must not duplicate inserts or resurrect stale local data.
- A replay of a completed plan is only safe when the remote still matches the completed journal.
- If the remote has drifted, replay must stay blocked and keep inspectable journal and remote artifacts.

Artifact expectations:

- `old-remote` and `fully-updated-remote` must carry journal evidence.
- `blocked-recovery` must carry both journal and remote artifacts.
- Durable journal records should be enough to distinguish the boundary that failed, but not replace production durability checks.
