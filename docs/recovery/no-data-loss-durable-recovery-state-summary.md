# No Data Loss Durable Recovery State Summary

Executable boundary:

- `node --test test/push-planner.test.js`

What it proves:

- Failure before mutation leaves the remote unchanged and records an `old-remote` recovery state.
- Failure after staging leaves the remote unchanged and records the staged journal as the artifact.
- Failure after dependency validation leaves the remote unchanged and records the dependency-validated journal as the artifact.
- Replaying a completed plan is inert and records a `fully-updated-remote` recovery state.
- A drifted completed replay is blocked and must carry both remote and journal artifacts.

Accepted post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Release gate:

- Any partial mutation without a recovery artifact is a blocker.
- Retry must not duplicate inserts or resurrect stale local data.
- A blocked recovery state is only acceptable when it includes inspectable artifacts for the remote and journal.
