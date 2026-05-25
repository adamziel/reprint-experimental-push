# No Data Loss Durable Recovery State Summary

The no-data-loss apply path accepts only three post-failure outcomes:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

## Failure Contract

- Failure before mutation must remain `old-remote`.
- Failure after staging must remain `old-remote`.
- Failure after dependency validation must remain `old-remote`.
- Replaying a completed plan must remain `fully-updated-remote`.
- A partial apply or stale replay must remain `blocked-recovery` and carry
  inspectable recovery artifacts.

## Release-Blocker Rule

A partial remote mutation without a recovery artifact is a release blocker.
Retries must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes without artifacts as safe

## Durable Journal Boundary

JSON fixtures are useful for modeling the contract, but production recovery
needs durable journal rows or files that survive restart and can be inspected
after failure. The durable journal, not the transient in-memory plan state, is
the recovery boundary.

