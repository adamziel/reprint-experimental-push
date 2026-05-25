# No Data Loss Recovery: Executable Boundary

The durable apply path is release-safe only when every failure or replay lands in one of three states:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with artifacts

The recovery contract is exercised by:

```bash
node --test test/push-planner.test.js
```

The important assertions are:

- Failure before mutation, after staging, and after dependency validation must preserve the old remote and write a durable recovery envelope.
- A completed plan replay must be inert: it must not reapply mutations, duplicate inserts, or resurrect stale local data.
- A blocked recovery result must carry artifacts for inspection instead of pretending the remote is safe.

This is the executable boundary for the no-data-loss lane. Anything that can partially mutate the remote without emitting a recoverable artifact is a release blocker.
