# No Data Loss Acceptable Post-Failure States

The atomic apply lane only considers three outcomes safe after a failure or
replay boundary:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

## Boundary contract

- Failure before mutation must stay `old-remote`.
- Failure after staging must stay `old-remote`.
- Failure after dependency validation must stay `old-remote`.
- Replaying a completed plan must stay `fully-updated-remote` and remain inert.
- Any partial remote mutation must surface `blocked-recovery` with inspectable
  journal and remote artifacts.

## Release blocker

A partial remote mutation without a durable recovery artifact is not safe.
Retry must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes as safe

## Evidence boundary

Planner tests cover the core model cases directly:

- failure before mutation
- failure after staging
- failure after dependency validation
- replaying a completed plan

Production recovery still needs durable journal writes, restart-readable
artifacts, and fencing around the apply boundary. The model tests prove the
contract shape; they do not replace durable storage guarantees.
