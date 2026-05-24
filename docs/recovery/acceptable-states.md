# Acceptable Post-Failure States

An apply attempt must end in one of these states:

- `old-remote`: no remote mutation committed. The recovery artifact is the
  journal that proves the plan can be retried after revalidation.
- `fully-updated-remote`: every planned mutation is already present. Replay
  may observe the completed journal, but it must not reapply inserts or stale
  local data.
- `blocked-recovery`: the remote is partial, drifted, or otherwise ambiguous.
  The recovery artifact set must include the journal plus any observed remote
  evidence needed to stop unsafe retry.

Anything else is unacceptable for a production partial remote mutation. If a
remote was mutated but the recovery artifact is missing, incomplete, or
uninspectable, treat that as a release blocker.

## Retry Rules

- Retrying an `old-remote` failure must not duplicate inserts.
- Retrying a `fully-updated-remote` journal must not resurrect stale local
  state.
- Retrying a `blocked-recovery` state must stop until recovery is resolved and
  the artifact envelope is inspectable again.

