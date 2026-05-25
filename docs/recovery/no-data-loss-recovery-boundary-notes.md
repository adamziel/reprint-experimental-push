# No Data Loss Recovery Boundary Notes

This note is a compact companion to the recovery contract and test matrix.

## Acceptable outcomes

After any interrupted apply, the system must land in exactly one of these states:

- `old-remote`: no remote mutation escaped the staging boundary.
- `fully-updated-remote`: every planned mutation is already present, and replay is read-only.
- `blocked-recovery`: the remote is partially advanced or ambiguous, and the artifacts are durable enough to inspect.

## Release blocker

Any partial remote mutation without a recovery artifact is a release blocker.
If the code cannot prove one of the safe outcomes above, it must stay blocked and surface inspectable artifacts instead of retrying blindly.

## Durable journal expectations

Lab-only JSON snapshots can prove the state machine, but production recovery needs durable journal records that survive process failure.
That means the journal must be restart-readable, flush-backed where applicable, and paired with fencing or lease protection so only one writer advances recovery state at a time.

## Replay rule

A completed replay must stay read-only.
It may confirm that the remote is already fully updated, but it must not duplicate inserts or resurrect stale local data.
