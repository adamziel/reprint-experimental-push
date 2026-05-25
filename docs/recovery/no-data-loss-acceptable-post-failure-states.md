# No Data Loss Acceptable Post-Failure States

`applyPlan()` must land in exactly one of these recoverable outcomes after a failure:

1. `old-remote`
   - No remote mutation is allowed to escape without durable recovery artifacts.
   - This is the expected outcome for failures before mutation, after staging, or after dependency validation.
   - The journal may record an opened, staged, or dependencies-validated boundary.
   - The remote artifact must be absent.

2. `fully-updated-remote`
   - The plan has already completed and replay is inert.
   - Replaying a completed plan must not duplicate inserts or resurrect stale local data.
   - The journal must show a completed recovery state.
   - The remote artifact must be absent.

3. `blocked-recovery`
   - A partial write was observed or recovery replay cannot be trusted.
   - Durable artifacts must include both the journal and the remote snapshot.
   - This is the only acceptable state for a partial remote mutation.

Release blocker rule:

- Any partial remote mutation without a recovery artifact is a release blocker.
- Retry must not duplicate inserts, resurrect stale local data, or treat partial writes as safe.
