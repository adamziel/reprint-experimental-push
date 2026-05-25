# No Data Loss Recovery

This lane treats atomic apply as a durable recovery protocol, not just an in-memory mutation.

## Accepted post-failure states

After any interrupted apply, the system must resolve to one of:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with inspectable artifacts

Any partial remote mutation without recovery artifacts is a release blocker.

## Boundary contract

The apply path is expected to stay within these boundaries:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

For the first three boundaries, the remote must remain in `old-remote` and the journal must preserve the interruption evidence.

For a completed plan replay, the remote must remain fully updated and the replay must be inert:

- no duplicate inserts
- no resurrection of stale local data
- no fresh mutation work

If the current remote drifts away from the completed journal, recovery must stay blocked and keep the artifacts inspectable.

## Recovery artifacts

Blocked recovery must carry enough evidence to inspect the failure safely:

- the durable journal
- the current remote snapshot

The journal should remain append-only across retries so completed plans can be replayed without duplicating the mutation set.

