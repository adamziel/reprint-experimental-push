# No Data Loss Recovery States

The atomic apply path has three acceptable post-failure outcomes:

1. `old-remote`
   - No remote mutation is committed.
   - This covers failures before mutation, after staging, and after dependency validation.
   - The journal may remain open, staged, or dependency-validated, but the remote must stay unchanged.

2. `fully-updated-remote`
   - Every planned mutation is committed.
   - Replaying the same completed plan must be inert.
   - Retry must not duplicate inserts or resurrect stale local data.

3. `blocked-recovery`
   - A partial remote mutation exists and the site cannot be safely treated as complete.
   - Both remote and journal artifacts must remain inspectable.
   - Recovery inspect must be able to explain why the plan is blocked.

Release rule:

- Any partial remote mutation without recovery artifacts is a blocker.
