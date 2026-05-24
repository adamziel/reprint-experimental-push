# Durable Journal Requirements

This lane distinguishes two different kinds of evidence:

1. Lab JSON and in-memory recovery artifacts used by tests.
1. Production durable journal storage used to survive real interruption.

The JSON evidence is useful for proving the model. It is not enough to declare
the production boundary safe unless the same state can be written durably and
recovered after a restart.

## Required production properties

The durable journal path must provide:

- append-only recovery rows or files
- durability after each critical append
- restart-readable recovery evidence
- claim or lease fencing so stale writers cannot keep mutating
- recovery inspection that can classify the current remote without replaying

## Recovery states

The apply path may only end in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Anything else is a release blocker.

## Failure boundaries

The named failure boundaries for this lane are expected to stay in
`old-remote`:

- failure before mutation
- failure after staging
- failure after dependency validation

Completed-plan replay must stay inert and return `fully-updated-remote`.

If the remote is partially mutated, the recovery result must be
`blocked-recovery` and include artifacts that describe the observed state.

