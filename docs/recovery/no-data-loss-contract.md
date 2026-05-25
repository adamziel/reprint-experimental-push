# No Data Loss Recovery Contract

This lane treats recovery as a strict three-state contract:

- `old-remote` for failures before any remote mutation is committed
- `fully-updated-remote` for completed plans and safe replays
- `blocked-recovery` when the remote may be partially updated and recovery artifacts are required

## Required behavior

- A failure before mutation, after staging, or after dependency validation must leave the remote unchanged.
- A completed replay must not apply fresh mutations again.
- A stale completed replay must block instead of pretending the remote is safe.
- Any partial remote mutation must carry recovery artifacts. A partial mutation without artifacts is a release blocker.

## Artifact expectations

- `old-remote` must include the journal artifact and must not include a remote artifact.
- `fully-updated-remote` must include the journal artifact and must not include a remote artifact.
- `blocked-recovery` must include both journal and remote artifacts.

## Durable journal note

The durable journal is the operational evidence trail. JSON test fixtures are useful for model coverage, but production recovery needs durable writes, claim fencing, and inspectable artifacts that survive process failure.

