# Durable journal executable boundary

This lane's recovery model is only release-safe when the apply path crosses a
real recovery boundary, not just a model fixture.

The first executable boundary that must exist once a live source URL is
available is:

1. `push_preflight` or the live apply entrypoint must prove the durable journal
   backend is writable.
2. `push_batch_apply` must open the journal before the first remote mutation.
3. `push_journal` or recovery inspect must be able to read the persisted trail
   after interruption.

The acceptable post-failure states stay fixed:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

Release gating rule:

- A partial remote mutation without a durable recovery artifact is a blocker.
- Retry must not duplicate inserts, revive stale local data, or collapse a
  partial state into `old-remote`.
- Completed replay must stay inert and classify as `fully-updated-remote`.

Production recovery still needs durable storage primitives behind this boundary:

- restart-readable journal rows or files
- flush or `fsync`-equivalent durability on the journal path
- claim fencing or lease ownership for the recovery writer
- recovery inspect that reads persisted artifacts instead of in-memory test
  state

The tests in `test/push-planner.test.js` prove the state machine in memory and
with temporary journal files. This note records the executable boundary that
still has to be wired into the live command path.
