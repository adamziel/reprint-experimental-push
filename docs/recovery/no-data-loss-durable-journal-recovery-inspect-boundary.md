# No Data Loss Durable Journal Recovery Inspect Boundary

This lane's recovery contract is only acceptable when the apply path can be
classified from durable artifacts after a crash, retry, or stale replay.

The only acceptable post-failure states are:

1. `old-remote`
   - The remote did not accept a committed mutation.
   - The recovery artifact may show opened, staged, or dependencies-validated
     progress, but no partial remote mutation is allowed to escape without a
     journal record.
   - Retry must not duplicate inserts or resurrect stale local data.

2. `fully-updated-remote`
   - The plan already completed.
   - Replay must remain read-only and inert.
   - The durable journal must be able to prove that the plan was completed
     before the retry path runs.

3. `blocked-recovery`
   - The remote is partially mutated or the replay state is no longer safe to
     classify as old or fully updated.
   - Both remote and journal artifacts must remain inspectable.
   - This is the only acceptable state for a partial remote mutation.

Release blocker:

- Any partial remote mutation without a recovery artifact is a release blocker.

Executable boundary to keep proving:

- journal opened before mutation
- journal staged before commit
- journal validated before commit
- completed replay against a matching remote
- stale completed replay against a drifted remote

The next implementation step should attach these states to a durable storage
primitive that survives process death and can be read back by recovery inspect.
