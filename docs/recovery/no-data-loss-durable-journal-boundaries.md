# No Data Loss Durable Journal Boundaries

This lane treats atomic apply as safe only when a failure or replay can be
classified into one of these outcomes:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

The model tests in `test/push-planner.test.js` prove those outcomes in memory.
Production recovery must keep the same boundary logic, but the proof has to come
from durable storage that survives a process restart:

- append-only journal rows or files that can be read back after failure
- fsync or equivalent persistence guarantees on the journal path
- explicit recovery artifacts for blocked partial state
- fencing or lease ownership around the writer so stale retries do not win

The safe failure boundaries that must remain distinguishable are:

1. failure before mutation
2. failure after staging
3. failure after dependency validation
4. replay of a completed plan
5. failure during commit, which must be blocked-recovery with artifacts if any
   remote mutation can already be observed

The acceptable post-failure states are strict:

- pre-mutation, staging, or validation failure must stay `old-remote`
- replay of a completed plan must stay `fully-updated-remote`
- any partial remote mutation without a durable recovery artifact is a release blocker

JSON fixtures and lab evidence are useful for proving the model, but they are not
production recovery by themselves. The durable journal is the artifact boundary
that must explain why a retry is safe or why the operator must inspect and fence
the partial state first.
