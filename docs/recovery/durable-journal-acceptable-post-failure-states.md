# Durable Journal Acceptable Post-Failure States

The no-data-loss recovery model allows only three outcomes after an interrupted apply attempt:

1. `old-remote`
   - No remote mutation became durable.
   - The journal may show `opened`, `staged`, or `dependencies-validated`, but the remote stays at the pre-apply state.
   - Retry must still treat the plan as unsafe to replay unless the durable journal proves the remote is unchanged.

2. `fully-updated-remote`
   - Every planned mutation is already present on the remote.
   - Replay is read-only and must not duplicate inserts, resurrect stale local data, or append fresh mutation evidence.
   - The durable journal should carry completed replay evidence.

3. `blocked-recovery`
   - Some remote mutation happened, but the system cannot prove the remote is fully old or fully updated.
   - Recovery artifacts are required. At minimum, the blocked state must preserve the journal, and when the remote was partially mutated it must also preserve a sanitized remote artifact.
   - Retrying must not be treated as safe until recovery resolves the artifact set.

Anything else is a release blocker for no-data-loss apply.
