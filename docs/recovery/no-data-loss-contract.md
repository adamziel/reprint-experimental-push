# No Data Loss Recovery Contract

This lane treats `applyPlan()` as a durability boundary, not just a pure
in-memory transformation.

## Acceptable Post-Failure States

After any injected or real failure, the system must end in one of these states:

1. `old-remote`
   - No remote mutation was committed.
   - The recovery journal may exist, but it must still describe the pre-commit
     boundary that failed.
   - Retrying from the journal must apply the plan exactly once.

2. `fully-updated-remote`
   - Every planned mutation is already present on the remote.
   - Replaying the completed journal must be inert.
   - Replay must not duplicate inserts or resurrect stale local data.

3. `blocked-recovery`
   - The remote is partially mutated or otherwise outside the before/after
     recovery envelope.
   - Recovery must remain inspectable through artifacts.
   - A blocked state is a release blocker if the remote was changed without a
     durable recovery artifact.

## Recovery Artifacts

Each recovery result should carry enough evidence to explain why the state is
safe or blocked:

- `journal` for the durable mutation record.
- `remote` only when the current remote state must be inspected to classify a
  partial or drifted recovery.
- A durable journal entry that records the boundary reached before the failure.

## Retry Rules

- A retry from `old-remote` must be able to complete the plan once.
- A retry from `fully-updated-remote` must remain inert.
- A retry from `blocked-recovery` must stay blocked until a human or another
  repair path resolves the drift.

