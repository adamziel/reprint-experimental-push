# Acceptable Post-Failure States

The apply contract accepts exactly three post-failure outcomes:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

These states are a safety contract, not just a test label.

## `old-remote`

No remote mutation was committed.

Required artifact:

- the recovery journal that proves the plan can be retried after revalidation

This state is valid after failures before mutation, after staging, or after
dependency validation, as long as the remote remains unchanged.

## `fully-updated-remote`

Every planned mutation is already present on the remote.

Required artifact:

- the completed recovery journal

Replay must not reapply inserts, rewrite already committed data, or resurrect
stale local state.

## `blocked-recovery`

The remote is partial, drifted, or otherwise ambiguous.

Required artifacts:

- the recovery journal
- the observed remote evidence needed to explain why retry is unsafe

This is the only acceptable state for a partial remote mutation. A partial
remote mutation without inspectable recovery artifacts is a release blocker.

## Operational Rule

If a retry cannot prove `old-remote` or `fully-updated-remote`, it must stop
in `blocked-recovery` with artifacts rather than treating the mutation as safe.
