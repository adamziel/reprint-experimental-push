# No Data Loss Acceptable Post-Failure States

The atomic apply flow has only three acceptable outcomes after a failure or replay check:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery`

## Contract

- `old-remote` means the remote still matches the before-hash envelope for every planned target.
- `fully-updated-remote` means the remote matches the after-hash envelope for every planned target and the plan can replay without reapplying mutations.
- `blocked-recovery` means the remote cannot be classified safely from the journal envelope and must carry recovery artifacts.
- A completed replay is only safe when the persisted journal still provides the full before-hash and after-hash envelope for every planned target.
- A completed replay is only safe when every planned target still matches the journaled after-hash envelope.
- A completed replay that sees drift must stop as `blocked-recovery`, not silently fall back to `old-remote`.
- Failure before mutation, after staging, and after dependency validation are only acceptable when they still report `old-remote`.
- A partial remote mutation without recovery artifacts is a release blocker.
- The production journal must make the same classification using durable rows or files, not only in-memory test fixtures.

## Artifact Rule

- `old-remote` and `fully-updated-remote` must carry journal artifacts.
- `blocked-recovery` must carry both journal artifacts and remote artifacts.
- A partial remote mutation without recovery artifacts is a release blocker.
- A completed replay should remain read-only even when retried against the same completed journal.
- JSON fixtures and lab-only journal files are evidence, not the production contract.
- Production recovery still needs durable journal rows or files with crash-safe persistence before a partial write can be treated as recoverable.
- Durable recovery must preserve enough evidence to inspect the remote after restart without guessing which mutation boundary was crossed.

## Retry Rule

- Retrying a completed plan must stay idempotent.
- Retrying must not duplicate inserts.
- Retrying must not resurrect stale local data.
- Retrying must not turn drifted completed replay evidence into a safe state.
- A completed replay that drifts from the journal envelope must be blocked, not treated as safe.
