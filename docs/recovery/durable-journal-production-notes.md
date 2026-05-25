# Durable journal production notes

The recovery model in this lane accepts only three post-failure outcomes:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

The lab tests prove the shape of those states, but production recovery still
needs durable storage that survives process exit and restart.

Minimum production requirements:

- journal rows or files that persist after a crash
- flush or `fsync`-equivalent durability before acknowledging recovery state
- claim fencing or lease ownership so only one writer can advance recovery
- restart-readable metadata for inspection without replaying the plan

Operational rule:

- treat any partial remote mutation without inspectable recovery artifacts as a blocker
- do not retry a completed plan if the current remote no longer matches the completed journal envelope
- do not treat stale local data as a reason to resurrect inserts or rewrite already committed remote state

