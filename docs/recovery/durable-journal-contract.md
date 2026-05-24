# Durable Recovery Contract

The recovery model in `src/apply.js` treats atomic apply as one of three post-failure states:

- `old-remote`: nothing was committed remotely; the journal is the recovery artifact.
- `fully-updated-remote`: every planned mutation is already present; the journal is the replay artifact.
- `blocked-recovery`: the remote drifted or partially applied outside the recoverable envelope; both journal and remote artifacts are required.

The contract is intentionally strict:

- A pre-commit failure may stage or validate work, but it must not leave a partially mutated remote without journal evidence.
- A completed replay must stay inert, return zero applied mutations, and not resurrect stale local data.
- A partial remote mutation without recovery artifacts is a blocker, not a safe retry target.

This lane's tests treat the journal as the source of truth for recovery classification and verify that the allowed states remain stable across failure injection and replay.
