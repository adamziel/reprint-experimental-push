# No Data Loss Durable Post-Failure Contract

This lane only accepts three post-failure outcomes from the atomic apply
boundary:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

Anything else is a release blocker.

## Boundary rules

- Failure before mutation stays `old-remote`.
- Failure after staging stays `old-remote`.
- Failure after dependency validation stays `old-remote`.
- Replaying a completed plan stays `fully-updated-remote` and must be inert.
- A completed replay must not duplicate inserts or resurrect stale local data.
- Any partial remote mutation must surface `blocked-recovery` with inspectable
  journal and remote artifacts.

## Artifact rules

- `old-remote` needs journal evidence that explains where the apply stopped.
- `fully-updated-remote` needs journal evidence that proves replay is inert.
- `blocked-recovery` needs both journal and remote artifacts so the partial or
  drifted state can be inspected after restart.

## Release blocker

A partial remote mutation without a durable recovery artifact is not safe.
Retry must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes as safe

## Coverage

The lane’s planner tests exercise these cases directly:

- failure before mutation
- failure after staging
- failure after dependency validation
- replaying a completed plan

