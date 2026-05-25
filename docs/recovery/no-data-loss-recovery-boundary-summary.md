# No Data Loss Recovery Boundary Summary

This lane treats the atomic apply boundary as safe only when the post-failure
state is one of:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

The apply path and its tests enforce four recovery checks:

- failure before mutation
- failure after staging
- failure after dependency validation
- replaying a completed plan

The contract is strict:

- A partial remote mutation without a recovery artifact is a release blocker.
- Retrying must not duplicate inserts.
- Retrying must not resurrect stale local data.
- A completed replay must stay read-only.
- If replay cannot stay safe, it must return `blocked-recovery` with the journal
  and remote artifacts needed for inspection.

This summary is intentionally narrow. The detailed invariants live in
[`src/apply.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/no-data-loss-recovery/src/apply.js)
and [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/no-data-loss-recovery/test/push-planner.test.js).
