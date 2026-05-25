# Durable Journal Recovery Contract

The apply boundary is only acceptable in three post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The release rule is simple:

- A failure before any mutation, after staging, or after dependency validation must leave the remote in `old-remote`.
- A replay of a completed plan must leave the remote in `fully-updated-remote`.
- Any partial remote mutation must be treated as `blocked-recovery` and must preserve both journal and remote artifacts.

This contract is intentionally strict:

- A partial mutation without recovery artifacts is a blocker.
- A retry must not duplicate inserts.
- A retry must not resurrect stale local data.
- Recovery inspection should be possible from the persisted artifacts, not from an in-memory guess.
