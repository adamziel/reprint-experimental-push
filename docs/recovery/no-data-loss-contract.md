# No Data Loss Recovery Contract

This lane keeps the push path inside three acceptable post-failure states:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with inspectable artifacts

The contract is intentionally conservative:

- A failure before remote mutation must leave the remote unchanged and surface only the journal artifacts needed to inspect the attempt.
- A completed plan replay must stay read-only and classify as `fully-updated-remote`.
- A partial commit is only acceptable when recovery is explicitly blocked and the durable artifacts include enough evidence to inspect the partial remote safely.

Durable recovery evidence is not the same as lab or JSON evidence:

- JSON or in-memory fixtures can help model the boundary.
- Production recovery requires durable journal rows, flushed file or DB writes, and a usable inspect path.
- Retry logic must not duplicate inserts, resurrect stale local data, or treat a partial write without artifacts as safe.

The tests in `test/push-planner.test.js` are the executable version of this contract.
