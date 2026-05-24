# Acceptable Post-Failure States

The atomic apply path is only acceptable if a failure leaves one of these states:

1. `old-remote`
   - No remote mutation is visible.
   - Recovery artifacts may exist and must explain why apply stopped.
   - Safe retries must reuse the artifact instead of guessing from local state.

2. `fully-updated-remote`
   - Every planned mutation is visible on the remote.
   - The durable journal must show completion or replay completion.
   - Replaying the same completed plan must not duplicate inserts or reapply stale local data.

3. `blocked-recovery`
   - The remote may be partially updated, or the journal may be incomplete.
   - Recovery artifacts are required.
   - Retrying must fail closed until fresh recovery evidence proves the site is safe to finish or abandon.

Anything else is a recovery bug.
