# No Data Loss Recovery Contract

This lane pins the recovery envelope for durable apply and replay.

## Acceptable post-failure states

An interrupted apply may only end in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Anything else is a contract violation.

## State rules

- `old-remote`
  - The remote site must remain unchanged.
  - The recovery state must keep the journal artifact.
  - The recovery state must not expose a remote artifact.

- `fully-updated-remote`
  - The remote site must already match the completed plan.
  - The recovery state must keep the completed journal artifact.
  - The recovery state must not expose a remote artifact.

- `blocked-recovery`
  - The remote site may be partially updated or drifted.
  - The recovery state must keep both journal and remote artifacts.
  - Retry must not duplicate inserts or resurrect stale local data.

## Replay contract

- Replaying a completed journal against a matching remote must be inert.
- Replaying a completed journal against a drifted remote must block with artifacts.
- A completed replay must not rewrite the remote site.

## Durable journal boundary checks

The planner tests pin the current recovery boundaries at:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

These boundaries are the minimum proof needed before a release can trust the durable recovery path.
