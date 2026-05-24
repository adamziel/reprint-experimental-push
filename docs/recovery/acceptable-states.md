# Acceptable Post-Failure States

An apply attempt must end in one of these states, and only these states:

- `old-remote`: no remote mutation committed. The recovery artifact is the
  journal that proves the plan can be retried after revalidation.
- `fully-updated-remote`: every planned mutation is already present. Replay
  may observe the completed journal, but it must not reapply inserts or stale
  local data. A completed-plan replay is only acceptable if it stays
  read-only and returns this state.
- `blocked-recovery`: the remote is partial, drifted, or otherwise ambiguous.
  The recovery artifact set must include the journal plus any observed remote
  evidence needed to stop unsafe retry.

Anything else is unacceptable for a production partial remote mutation. If a
remote was mutated but the recovery artifact is missing, incomplete, or
uninspectable, treat that as a release blocker.

Completed-plan replay must classify as `fully-updated-remote`. It may observe a
completed journal envelope, but it must not duplicate inserts or resurrect
stale local data.

## Retry Rules

- Retrying an `old-remote` failure must not duplicate inserts.
- Retrying a `fully-updated-remote` journal must not resurrect stale local
  state or reapply any mutation.
- Retrying a `blocked-recovery` state must stop until recovery is resolved and
  the artifact envelope is inspectable again.
