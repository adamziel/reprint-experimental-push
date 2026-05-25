# No Data Loss Recovery

This lane treats durable apply as a three-state post-failure envelope:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The apply path must not leave a partial remote mutation without an inspectable
recovery artifact. If a failure happens before commit, the remote stays in the
old state and the journal remains replayable. If the plan has already completed,
replay must stay inert and leave the remote unchanged. If the live remote has
drifted or a durable write fails after mutation, recovery must block and carry
the journal plus remote artifacts needed for inspection.

Relevant coverage lives in `test/push-planner.test.js`:

- failure before mutation
- failure after staging
- failure after dependency validation
- completed replay
- blocked recovery with artifacts
