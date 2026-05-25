# No Data Loss Durable Recovery Contract

This lane accepts only three post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

## Boundary contract

- Failure before mutation stays `old-remote`.
- Failure after staging stays `old-remote`.
- Failure after dependency validation stays `old-remote`.
- Replaying a completed plan stays `fully-updated-remote` and must be inert.
- A completed replay must not reopen mutation work, duplicate inserts, or surface stale local data as new remote state.
- Any partial remote mutation must surface `blocked-recovery` with inspectable artifacts.

These are the only acceptable post-failure outcomes for this lane:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

The failure envelope is intentionally narrow:

- old remote means the remote is still classifiable as the pre-apply state
  and the journal explains where the apply stopped.
- fully updated remote means replay is read-only and produces no duplicate
  inserts, stale-data resurrection, or fresh mutation work.
- blocked recovery means the remote cannot be trusted as safely old or safely
  complete, so the journal must carry enough remote evidence to inspect the
  partial state after restart.

## Release blocker

A partial remote mutation without a recovery artifact is not acceptable.

Retry must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes as safe

## Durable evidence

JSON lab evidence is useful for modeling, but production recovery needs durable
journal records that survive the failure boundary and can be inspected after
restart. The journal is the artifact boundary, not the final proof by itself:

- pre-mutation, post-staging, and post-validation failures must leave a durable
  `old-remote` record
- replay of a completed plan must leave a durable `fully-updated-remote`
  record without reopening mutation work
- blocked recovery must preserve both journal and remote artifacts

Production recovery still needs real durable writes, restart-readable journal
storage, and fencing around the apply boundary. The JSON-model tests prove the
contract shape; they do not replace production durability guarantees.
