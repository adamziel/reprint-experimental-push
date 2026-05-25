# Acceptable Post-Failure States

The durable apply path is only allowed to leave the system in one of three recovery states.
Any other outcome is a release blocker because it either hides a partial write or makes
retry semantics ambiguous:

1. `old-remote`
   - No remote mutation has been committed.
   - The journal may show `opened`, `staged`, or `dependencies-validated`.
   - This covers failure before mutation, after staging, and after dependency validation.
   - Recovery remains inspectable from artifacts, but the remote must remain unchanged.
   - A retry against the same plan must still be able to classify the site as old remote.

2. `fully-updated-remote`
   - Every planned mutation has been committed.
   - Replay of the same completed plan is inert.
   - The journal must be marked `completed` and replay must not duplicate inserts or revive stale local data.
   - A completed journal replay must keep the remote unchanged and preserve the completed recovery state.

3. `blocked-recovery`
   - A partial remote mutation exists and the plan cannot be safely replayed.
   - Both the journal and the current remote must be preserved as artifacts.
   - This is the only acceptable state for a partial commit without a clean completion record.
   - A completed plan replay that drifts from the current remote also belongs here.
   - The recovery inspect boundary must be able to explain why the plan is blocked.

Release rule: any partial remote mutation without a blocked recovery artifact is a blocker.
