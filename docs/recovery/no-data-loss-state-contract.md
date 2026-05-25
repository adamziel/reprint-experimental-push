# No Data Loss Recovery State Contract

This lane treats the apply boundary as a durable journal boundary.

## Accepted outcomes

An interrupted or retried apply must land in exactly one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Anything else is a release blocker.

## Boundary rules

- Failure before the first remote mutation stays `old-remote`.
- Failure after staging but before commit stays `old-remote`.
- Failure after dependency validation but before commit stays `old-remote`.
- A fully completed apply is `fully-updated-remote`.
- A completed-plan replay must stay inert and must not duplicate inserts or revive stale local data.

## Artifact rules

- `old-remote` and `fully-updated-remote` carry the durable journal artifact only.
- `blocked-recovery` carries both the durable journal artifact and the remote artifact.
- A partial remote mutation without a recovery artifact is not acceptable.

## Recovery intent

The recovery journal is the executable proof boundary for:

- pre-mutation failure
- post-staging failure
- post-validation failure
- completed replay

The apply path may only mutate the remote when the durable journal can still explain the state after interruption.
