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

A partial remote mutation without a recovery artifact is a release blocker, even
if the write path eventually reports success on a later retry. The retry path
must never duplicate inserts or resurrect stale local data from an outdated
journal.

## Failure Boundaries

The atomic apply boundary checks must keep these failure modes inside the contract above:

- Failure before mutation must leave `old-remote` plus a recovery artifact.
- Failure after staging must still leave `old-remote` plus a recovery artifact.
- Failure after dependency validation must still leave `old-remote` plus a recovery artifact.
- Replaying a completed plan must return `fully-updated-remote`, not a second write path.
- If replay finishes the remote but the durable replay record fails, the result must still classify as `fully-updated-remote` with artifacts.
- If a completed journal no longer matches the current remote, durable replay must block with `blocked-recovery` and artifacts.
- If a completed journal no longer matches the remote, the result must be `blocked-recovery` with artifacts, never a silent retry.
