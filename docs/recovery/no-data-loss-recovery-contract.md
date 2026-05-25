# No Data Loss Recovery Contract

This lane treats `src/apply.js` as safe only when every apply attempt ends in
one of these inspectable states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with journal and remote artifacts

The durable journal is the release boundary. The in-memory model in
`test/push-planner.test.js` proves the policy, but production must satisfy the
same contract with persisted artifacts that survive restart.

## Failure boundaries

The apply path must remain distinguishable at these points:

1. before any mutation is applied
1. after staging the plan
1. after dependency validation
1. during commit, when the remote may already be partially updated
1. replay of a completed plan

## Recovery rules

- Pre-mutation, staging, and dependency-validation failures must remain
  `old-remote`.
- A completed plan replay must remain `fully-updated-remote`.
- A partial remote mutation without a durable recovery artifact is a release
  blocker.
- If a partial mutation is observable, the recovery state must be
  `blocked-recovery` and must preserve both the journal and the remote
  snapshot for inspection.

## Durable storage expectations

The next production hook should be the first executable boundary that can prove
the journal is durable, readable, and fenced:

- append-only journal rows or files
- fsync or equivalent durability on the journal path
- claim or lease fencing so stale retries do not win
- recovery inspection that can explain why a retry is safe or blocked

