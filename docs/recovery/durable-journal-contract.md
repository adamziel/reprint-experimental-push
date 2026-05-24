# Durable Recovery Journal Contract

The recovery tests in this lane use JSON fixtures and in-memory objects to model
apply failures, but production recovery needs a durable journal with stronger
guarantees:

- the journal must survive process exit and restart;
- the journal must be written before the executor treats a partial apply as safe;
- the journal must preserve enough evidence to classify `old-remote`,
  `fully-updated-remote`, or `blocked-recovery`;
- a partial remote mutation without a durable recovery artifact is a release
  blocker.

Fixture-based evidence is still useful for proving the state machine, but it is
not the same thing as production durability. In particular, JSON test doubles do
not prove database row durability, fsync semantics, plugin activation fences, or
filesystem crash recovery.

Accepted recovery outcomes remain narrow:

- `old-remote`: no remote mutation escaped the failure boundary.
- `fully-updated-remote`: replay observed that the completed plan already
  matched the live remote.
- `blocked-recovery`: the remote may be partially updated, but the journal and
  live hashes prove the executor cannot safely infer completion.

Replay must stay idempotent. If a completed plan is replayed against a matching
remote, it must not duplicate inserts or resurrect stale local data.
