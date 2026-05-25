# No Data Loss Durable Journal Replay Boundary

The recovery boundary for `src/apply.js` is only acceptable when every path
lands in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with journal and remote artifacts

## Executable proof

The current proof is the planner test matrix:

```bash
node --test test/push-planner.test.js
```

That matrix pins four release-gate cases:

1. failure before mutation
1. failure after staging
1. failure after dependency validation
1. replaying a completed plan

## Release rule

A partial remote mutation without a recovery artifact is a blocker.

Retry must not duplicate inserts or resurrect stale local data. A completed
replay is only safe when it stays inert and reports `fully-updated-remote`.
