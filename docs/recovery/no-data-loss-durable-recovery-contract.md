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
- Any partial remote mutation must surface `blocked-recovery` with inspectable artifacts.

## Release blocker

A partial remote mutation without a recovery artifact is not acceptable.

Retry must not:

- duplicate inserts
- resurrect stale local data
- treat partial writes as safe

## Durable evidence

JSON lab evidence is useful for modeling, but production recovery needs durable journal records that survive the failure boundary and can be inspected after restart.

