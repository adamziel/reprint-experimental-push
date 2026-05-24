# Acceptable Post-Failure States

This lane treats durable recovery as valid only when an interrupted apply lands in one of these states:

1. `old-remote`
1. `fully-updated-remote`
1. `blocked-recovery` with artifacts

The named failure boundaries in this lane are expected to stay in `old-remote`:

- failure before mutation
- failure after staging
- failure after dependency validation

Completed-plan replay is only acceptable when it returns `fully-updated-remote` and stays inert.

## Old remote

The remote remains unchanged from the last known good state.

Required artifacts:

- Journal evidence showing where the apply stopped.
- No committed remote mutation is required.

This state is acceptable for failures before any remote mutation is committed, including failures:

- before mutation
- after staging
- after dependency validation

A partial remote mutation without a durable recovery artifact is never acceptable.

## Fully updated remote

The remote matches the completed plan and replay is inert.

Required artifacts:

- Journal evidence proving the plan was already completed.

Retry must not:

- apply the same insert twice
- resurrect stale local data
- create new mutation work

## Blocked recovery with artifacts

The remote is partially or suspiciously updated and must not be treated as safe to replay.

Required artifacts:

- durable journal evidence
- remote-state evidence describing the observed drift or partial commit

This is the release-blocker state if a retry would otherwise risk:

- duplicate inserts
- stale data resurrection
- silent partial write reuse without a recovery artifact

The artifact pair must make inspection possible:

- durable journal evidence
- remote-state evidence describing the observed drift or partial commit

## Operational rule

Any failure path must end in one of the three states above.

If the remote is not fully old or fully updated, the recovery result must be blocked and inspectable.
