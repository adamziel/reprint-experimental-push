# Apply Journal Recovery States

The current recovery slice is lab evidence, not production durable recovery.
It uses a bounded option journal in the Playground lab to classify a failed
apply without storing raw before/after values. It is not process-kill safe, is
not backed by `fsync`, and does not auto-repair a partial remote.

The production design target is a durable artifact that separates a safe retry
from an unsafe partial push. A failed apply must leave the system classifiable
as only one of these states:

- `old-remote`: no remote mutation was committed. The journal records the plan,
  before/after hashes, and the last completed boundary so the push can be
  retried after revalidating preconditions.
- `fully-updated-remote`: every planned mutation is present on the remote. A
  completed journal may be replayed, but replay must not reapply mutations.
- `blocked-recovery`: the remote may be partial, drifted, or otherwise
  ambiguous. The journal and observed remote snapshot are required artifacts,
  and automated retry must stop until recovery is resolved.

Any production partial remote mutation without a `blocked-recovery` artifact is
a release blocker.

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

## Current Lab Evidence

`npm run test:playground:recovery` verifies the lab failpoint
`REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS=N` / `labFailAfterMutations`. In the
fail-after-2 scenario the PHP protocol reports
`LAB_INJECTED_APPLY_FAILURE` after two successful whole-resource mutations,
leaving `2 new` targets and `6 old` targets. CLI inspect and
`GET /recovery/inspect` classify the remote as `blocked-recovery`, with target
states reported as old, new, or blocked-unknown, and a retry refuses with
`PRECONDITION_FAILED`.

The journal records planned recovery entries, `mutation-applied`,
`apply-failed`, `recovery-required`, and current hashes without raw values. This
is enough to prove the lab classification path, but it is still not a durable
production journal, not process-kill/`fsync` proof, and not an automated repair
mechanism.
