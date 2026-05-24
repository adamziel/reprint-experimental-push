# No Data Loss Recovery

This lane treats the apply journal as the source of truth for crash recovery.
The acceptable post-failure outcomes are limited to:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with recovery artifacts

Anything else is a release blocker, especially a partial remote mutation that
does not leave inspectable recovery evidence.

## Recovery Boundaries

The apply path is expected to behave consistently across these boundaries:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

For each of those boundaries, the remote must remain in one of the acceptable
states above, and replay must not duplicate inserts or resurrect stale local
data.

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

## Operational Rule

Never treat a partial write without recovery artifacts as safe. If the remote
has drifted or a replay cannot be classified, recovery stays blocked until the
artifacts prove the next action.
