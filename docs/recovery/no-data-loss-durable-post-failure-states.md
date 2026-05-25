# No Data Loss Durable Post-Failure States

The atomic apply path may fail at several boundaries, but it must never leave a
partial remote mutation without recovery artifacts.

Accepted outcomes after a failure:

1. `old-remote`
   - The remote site is unchanged.
   - The recovery journal may contain staged or validation evidence.
   - The failure must surface a recovery artifact bundle that can be retried.

2. `fully-updated-remote`
   - The remote site already matches the completed plan.
   - A completed replay must remain inert and must not duplicate inserts.
   - Stale local data must not be resurrected during replay.

3. `blocked-recovery`
   - A partial mutation happened and the recovery state must stay blocked.
   - The failure must retain inspectable remote and journal artifacts.
   - Retry must not be treated as safe unless inspection proves the plan is complete.

Boundary classification:

- Failure before mutation, after staging, and after dependency validation are all
  `old-remote` states.
- A completed replay is `fully-updated-remote`.
- Mid-apply partial writes are `blocked-recovery` and remain blocked on inspection.

Release rule:

- Any partial remote mutation without a recovery artifact is a release blocker.
- Retry must never create duplicate inserts or reintroduce stale local state.
