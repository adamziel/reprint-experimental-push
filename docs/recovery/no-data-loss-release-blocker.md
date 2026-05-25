# No Data Loss Release Blocker

This lane only allows three post-failure outcomes:

1. `old-remote`
   - No remote mutation became visible.
   - The durable journal may contain opened, staged, or validation evidence.
2. `fully-updated-remote`
   - Every planned mutation is already on the remote.
   - Completed replays must stay inert.
3. `blocked-recovery`
   - The remote is partially updated or drifted.
   - Recovery artifacts must be preserved for inspection and fencing.

Anything else is a release blocker.

The important distinction is not whether a test-model replay succeeds. It is
whether a retry can be explained by durable evidence:

- failure before mutation, after staging, or after dependency validation stays
  `old-remote`
- replaying a completed plan stays `fully-updated-remote`
- any partial remote mutation without durable recovery artifacts is blocked

JSON fixtures and lab evidence are useful for proving the model, but the
production boundary must come from durable journal rows or files that survive a
restart.
