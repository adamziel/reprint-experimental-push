# No Data Loss Durable Recovery States

This lane treats the apply journal as a durable recovery boundary, not just an
in-memory execution trace. After any failed apply, the system must end in one
of three acceptable states:

1. `old-remote`
   - No remote mutation is committed.
   - The recovery journal may show `opened`, `staged`, or
     `dependencies-validated` for failures before mutation, after staging, or
     after dependency validation.
   - Recovery artifacts must identify the plan and journal boundary, but must
     not claim the remote is updated.

2. `fully-updated-remote`
   - Every planned mutation is committed.
   - Replay of a completed plan must stay read-only.
   - Recovery artifacts may include the completed journal, but must not add a
     synthetic remote snapshot that could resurrect stale local state.

3. `blocked-recovery`
   - The remote or journal has drifted enough that retry is unsafe.
   - Recovery must keep both journal and remote artifacts so the operator can
     inspect the blocked state.
   - A partial remote mutation without durable artifacts is a release blocker.

## Durable Artifact Expectations

The production boundary needs more than lab-style JSON evidence. It needs:

- persisted journal rows or equivalent durable records
- fsync or equivalent flush semantics before declaring a boundary durable
- plugin activation and resource ownership checks recorded in the journal
- leases or fencing for stale claims before committing remote mutations
- recovery inspection against the persisted journal, not just in-memory state

## Retry Rule

Retries must not:

- duplicate inserts
- revive stale local data
- treat a partial write without recovery artifacts as safe

If the recovery journal cannot prove `old-remote` or `fully-updated-remote`,
the result is `blocked-recovery`.
