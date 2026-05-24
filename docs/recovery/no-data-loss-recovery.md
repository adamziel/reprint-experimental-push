# No Data Loss Recovery

This lane treats the apply journal as the source of truth for crash recovery.
The acceptable post-failure outcomes are limited to:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with recovery artifacts

Anything else is a release blocker, especially a partial remote mutation that
does not leave inspectable recovery evidence.

## Post-Failure Contract

Every interrupted apply must classify into exactly one of these states:

- `old-remote`: the remote stayed on the pre-apply side of the failure boundary.
- `fully-updated-remote`: the full plan was already committed and replay is inert.
- `blocked-recovery` with artifacts: the remote or journal is not safe to trust
  without inspection.

That contract is strict enough to prevent the unsafe cases this lane is meant to
reject:

- no duplicate inserts on retry
- no resurrection of stale local data
- no silent reuse of a partial write that lacks recovery evidence

If a failure path cannot be classified from recovery artifacts alone, it is not
acceptable for release.

## Recovery Boundaries

The apply path is expected to behave consistently across these boundaries:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

For each of those boundaries, the remote must remain in one of the acceptable
states above, and replay must not duplicate inserts or resurrect stale local
data. A completed-plan replay is only acceptable when the journal still matches
the remote after-hash envelope; otherwise the outcome is `blocked-recovery`
with inspectable journal and remote artifacts.

The completed-plan replay case is only acceptable when the journal still
matches the remote after hashes. If the remote has drifted since completion,
the outcome is not `fully-updated-remote`; it is `blocked-recovery` with the
remote and journal artifacts needed to inspect the drift.

## Durable Journal Expectations

The recovery journal should be durable enough to answer these questions after a
restart:

- What plan was being applied?
- Which targets were staged or committed?
- Is the current remote safely old, fully updated, or blocked for recovery?

That means recovery evidence should remain inspectable even when the apply path
fails before returning. The journal is expected to carry enough artifacts to
distinguish:

- an untouched remote that can be retried
- a fully applied remote that can be replayed idempotently
- a blocked recovery state that requires inspection before retry

In production, those artifacts need durable storage behavior, not just a model
object in memory. A safe implementation needs the same recovery classification
after restart, including any fsync, row commit, or fencing behavior required by
the underlying store.

## Durable Vs. Lab Evidence

The JSON evidence used in tests and model checks is only a proof artifact. It
is not a substitute for production durability or restart-safe recovery.

Production recovery needs durable writes for:

- journal rows or entries that survive process exit
- fsync or equivalent flush semantics for the journal file or store
- activation or lease fencing so only one writer can advance recovery state
- inspectable recovery metadata for restart-time diagnosis

That distinction matters because a recovery state can look complete in memory
while still being unsafe if the journal was not durably committed.

## Operational Rule

Never treat a partial write without recovery artifacts as safe. If the remote
has drifted or a replay cannot be classified, recovery stays blocked until the
artifacts prove the next action.
