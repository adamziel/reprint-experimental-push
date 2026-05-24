# Durable Journal Contract

The recovery model in this lane intentionally distinguishes between:

- lab JSON fixtures and restart-inspection evidence
- the production durable journal contract that must survive process loss

## Acceptable Post-Failure States

An apply attempt may end in one of these states:

1. `old-remote`
   - No remote mutation has become durable.
   - Recovery artifacts must include the journal snapshot that explains why the apply stopped.
2. `fully-updated-remote`
   - Every planned mutation is already present on the remote.
   - Recovery artifacts must include the completed journal snapshot.
3. `blocked-recovery`
   - The remote is partially applied or has drifted outside the journal envelope.
   - Recovery artifacts must include both the journal snapshot and the inspected remote snapshot.

A partial remote mutation without a recovery artifact is a release blocker.

## Retry Rules

Retries must not:

- duplicate inserts
- resurrect stale local data from an outdated journal
- treat a partial write without artifacts as safe to continue

If a completed journal no longer matches the remote, recovery stays blocked until the operator resolves the mismatch and re-runs inspection.

## Production vs Lab Evidence

The lab JSON model is useful for restart inspection and failure injection, but it is not the production durability boundary.

Production recovery needs explicit durable evidence for:

- journal append ordering
- fsync-backed persistence
- plugin activation and dependency claims
- fencing or lease invalidation when a stale worker is superseded
- recovery inspection of the live remote before retry

The durable journal must therefore carry enough metadata to prove which of those boundaries were reached before failure, without depending on ephemeral in-memory state.
