# No Data Loss Recovery States

The atomic apply model is only acceptable when the post-failure state is one of
the following:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

## Why this matters

The test model in this lane uses JSON fixtures and temporary journal writers to
prove the state machine. That is enough to validate the recovery contract, but
it does not replace production durability.

## Failure boundaries

- Failure before mutation must keep the remote on `old-remote`.
- Durable journal failure before mutation must also remain `old-remote` and
  preserve the journal artifact that explains the blocked retry boundary.
- Failure after staging must keep the remote on `old-remote`.
- Failure after dependency validation must keep the remote on `old-remote`.
- Replaying a completed plan against the same remote must remain
  `fully-updated-remote` and stay inert.
- Replaying a completed plan against a matching remote must remain
  `fully-updated-remote`.
- Replaying a completed plan against drift must become `blocked-recovery` and
  preserve the journal plus remote artifacts that explain the block.
- A partial remote mutation without a durable recovery artifact is a release
  blocker, even if the mutated resources happen to resemble the target state.

## Test evidence

The lane-level regression suite exercises four boundaries that must stay
stable:

- failure before mutation
- failure after staging
- failure after dependency validation
- replaying a completed plan

Those tests only consider a boundary safe when the persisted recovery state is
one of the accepted outcomes above. Anything else is treated as a blocked
recovery artifact, not a safe retry target.

## Release blocker

Retries must not duplicate inserts, resurrect stale local data, or treat
partial writes without artifacts as safe. The blocked recovery state must keep
inspectable artifacts so a restart can explain the failure instead of guessing.

## Production durability

Production recovery needs durable evidence that survives process failure:

- append-only journal rows or files
- flush or fsync semantics on the write path
- fencing or claim ownership so only one writer advances the journal
- restart-readable recovery metadata
- inspect tooling that can explain the recovered remote state after restart

The test suite in this lane uses JSON fixtures and temporary journal writers to
model these guarantees. That is useful for contract coverage, but production
durability still needs real storage boundaries.
