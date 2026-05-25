# Durable Recovery Artifact Contract

This lane treats the atomic apply journal as the recovery source of truth.
The only acceptable post-failure outcomes are:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

## Boundary Rules

- failure before mutation: `old-remote`
- failure after staging: `old-remote`
- failure after dependency validation: `old-remote`
- replay of a completed plan with a matching journal: `fully-updated-remote`
- replay of a completed plan with remote drift: `blocked-recovery` with journal and remote artifacts
- retry after a blocked replay: still `blocked-recovery` until the remote matches the journaled after state
- partial remote mutation without a durable recovery artifact: release blocker

## Artifact Expectations

Test fixtures can prove the recovery shape with JSON state and temporary files.
That is useful for regression coverage, but it is not production durability.
The test contract still matters because it must prove the lane never treats a
partial write as safe and never replays a completed plan by duplicating inserts
or resurrecting stale local data.

A production recovery journal still needs:

- durable journal rows or files that survive process exit
- fsync or equivalent flush semantics
- claim fencing or lease activation so only one writer advances recovery state
- restart-readable recovery metadata for inspection without replay

## Safety Rule

Retry must not duplicate inserts, resurrect stale local data, or treat a
partial write as safe unless the recovery artifacts prove the next step.
