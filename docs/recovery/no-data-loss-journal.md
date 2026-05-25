# No Data Loss Recovery

The durable apply path treats recovery as one of three states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Those states are the only acceptable post-failure envelopes.

## Executable Proof

The main regression coverage lives in [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/no-data-loss-recovery/test/push-planner.test.js).

The relevant proof cases are:

- failure before mutation
- failure after staging
- failure after dependency validation
- replaying a completed plan

The tests assert that:

- the remote stays old until commit
- a completed replay stays fully updated and applies zero new mutations
- blocked recovery carries journal and remote artifacts
- retries do not duplicate inserts
- retries do not resurrect stale local data
- the only acceptable post-failure states are `old-remote`, `fully-updated-remote`, or `blocked-recovery`
- any partial remote mutation without recovery artifacts remains a release blocker

If any failure leaves the remote partially mutated without a recovery artifact, that is a release blocker.
