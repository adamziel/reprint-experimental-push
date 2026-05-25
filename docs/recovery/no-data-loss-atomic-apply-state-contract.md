# No Data Loss Atomic Apply State Contract

This lane treats durable recovery as safe only when every post-failure outcome lands in one of these states:

1. `old-remote`
   - No remote mutation has been committed.
   - The recovery journal may contain an opened or staged boundary.
   - Durable recovery artifacts should include the journal, but not require a remote snapshot.

2. `fully-updated-remote`
   - All planned mutations are present on the remote.
   - A completed journal exists and can be replayed without changing the remote.
   - Replaying a completed plan must stay inert and must not duplicate inserts or resurrect stale local data.

3. `blocked-recovery`
   - A partial remote mutation or stale replay was observed.
   - Recovery must remain blocked until inspectable artifacts are available.
   - Both journal artifacts and remote artifacts must be preserved so the failure can be inspected safely.

Release rule:

- A partial remote mutation without a recovery artifact is a blocker.
- Any retry path must either complete cleanly or remain blocked with artifacts.
- Safe replay never converts a blocked recovery into an `old-remote` classification.

Boundary notes:

- Failure before mutation, after staging, and after dependency validation should stay `old-remote`.
- A replay of a completed plan should stay `fully-updated-remote`.
- Stale completed replay and mid-apply partial commit belong in `blocked-recovery` with artifacts.
