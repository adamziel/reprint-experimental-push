# Atomic Apply Recovery States

`applyPlan()` now treats recovery as a small state machine with durable journal evidence.

Acceptable post-failure states:

- `old-remote`: no remote mutation was committed
- `fully-updated-remote`: the plan was already applied and can be replayed without reapplying mutations
- `blocked-recovery`: the remote drifted, a recovery claim was superseded, or the journal artifacts are incomplete or inconsistent

Recovery artifacts must always identify which of those states occurred. A partial remote mutation without a recovery artifact is not acceptable.

Operational notes:

- Failures before mutation, after staging, and after dependency validation should keep the remote in `old-remote` and preserve a journal artifact.
- Replaying a completed plan should return `fully-updated-remote` and must not duplicate inserts or resurrect stale local data.
- If recovery inspection cannot prove safety, the result must be `blocked-recovery` with artifacts that explain why recovery is blocked.
