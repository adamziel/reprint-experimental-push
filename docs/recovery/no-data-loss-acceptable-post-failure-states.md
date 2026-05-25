# No Data Loss Acceptable Post-Failure States

The atomic apply flow has only three acceptable outcomes after a failure or replay check:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery`

## Contract

- `old-remote` means the remote still matches the before-hash envelope for every planned target.
- `fully-updated-remote` means the remote matches the after-hash envelope for every planned target and the plan can replay without reapplying mutations.
- `blocked-recovery` means the remote cannot be classified safely from the journal envelope and must carry recovery artifacts.

## Artifact Rule

- `old-remote` and `fully-updated-remote` must carry journal artifacts.
- `blocked-recovery` must carry both journal artifacts and remote artifacts.
- A partial remote mutation without recovery artifacts is a release blocker.

## Retry Rule

- Retrying a completed plan must stay idempotent.
- Retrying must not duplicate inserts.
- Retrying must not resurrect stale local data.
- A completed replay that drifts from the journal envelope must be blocked, not treated as safe.
