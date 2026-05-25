# Durable Journal Executable Boundary

The no-data-loss recovery gate for this lane is the planner test suite:

```bash
node --test test/push-planner.test.js
```

That executable boundary must keep proving these outcomes:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

The only acceptable post-failure states are:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with recovery artifacts

Release rule: a partial remote mutation without a recovery artifact is a blocker.
Retries must not duplicate inserts or resurrect stale local data.
