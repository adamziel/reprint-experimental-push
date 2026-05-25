# No Data Loss Recovery Contract

This lane keeps the apply path inside a small set of acceptable post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The goal is to prevent a partially mutated remote from being treated as safe unless the recovery artifact makes that state explicit and inspectable.

## State meaning

### `old-remote`

The remote stayed unchanged. The recovery artifact should show the plan was opened or staged, but no remote mutation was committed.

### `fully-updated-remote`

The remote already contains every planned mutation. Replay must be inert and must not duplicate inserts or resurrect stale local data.

### `blocked-recovery`

The remote is partially or ambiguously mutated, or the recovery journal no longer proves safe replay. This state must carry artifacts for inspection.

## Evidence model

Test fixtures and JSON snapshots are useful for proving behavior, but they are not the production durability boundary.

Production recovery needs durable journal writes that survive process failure:

- DB rows or filesystem artifacts that record plan open, staging, dependency validation, commit, and completion
- fsync-backed persistence where the platform supports it
- plugin activation or other fencing signals when those are part of the mutation boundary
- recovery inspection artifacts that let the operator distinguish `old-remote`, `fully-updated-remote`, and `blocked-recovery`

## Retry rules

- Retry must not duplicate inserts.
- Retry must not resurrect stale local data once the remote already contains the completed plan.
- A partial remote write without a recovery artifact is a release blocker.
- If the journal cannot prove a safe replay, the only valid outcome is `blocked-recovery` with artifacts.

## Test coverage target

The current test matrix should keep covering:

- failure before mutation
- failure after staging
- failure after dependency validation
- completed-plan replay
- stale completed replay
- blocked partial recovery

