# Apply Journal Recovery States

The apply model treats the journal as the durable artifact that separates a
safe retry from an unsafe partial push. A failed apply may leave the system in
only one of these states:

- `old-remote`: no remote mutation was committed. The journal records the plan,
  before values, after values, and the last completed boundary so the push can
  be retried after revalidating preconditions.
- `fully-updated-remote`: every planned mutation is present on the remote. A
  completed journal may be replayed, but replay must not reapply mutations.
- `blocked-recovery`: the remote may be partial, drifted, or otherwise
  ambiguous. The journal and observed remote snapshot are required artifacts,
  and automated retry must stop until recovery is resolved.

Any partial remote mutation without a `blocked-recovery` artifact is a release
blocker.

## Boundaries

The current lab journal records these apply boundaries:

- `opened`: preconditions matched and the journal has before/after values.
- `staging`: at least one mutation was staged into the candidate remote.
- `staged`: every mutation was staged, but dependency validation has not
  completed.
- `dependencies-validated`: staged content satisfies atomic group dependencies.
- `committing`: mutations are being committed to the remote target.
- `completed`: all mutations were committed.
- `blocked`: commit did not finish cleanly and recovery requires inspection.

Completed replay validates that current remote resources still match the
journaled after hashes. If any resource drifted after completion, replay blocks
instead of resurrecting stale local data.
