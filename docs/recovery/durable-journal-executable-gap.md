# Durable Journal Executable Gap

The no-data-loss recovery model now distinguishes three acceptable post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

That contract is useful, but it is still only a model until the apply path is backed by a crash-safe journal and replay command that survive process loss.

## What must be executable before release

- Durable journal rows must be written to real storage, not lab-only JSON objects.
- Journal writes must survive a crash boundary with `fsync` or the platform-equivalent durability step.
- Recovery inspection must read the persisted journal and classify the remote state from it.
- Lease or fencing rules must prevent stale workers from mutating after a newer claim exists.
- Plugin activation and DB state need durable evidence, not just in-memory replay results.

## Release blocker

A partial remote mutation without a recovery artifact is a release blocker.

If the apply path can mutate remote state but cannot leave an inspectable journal or recovery record behind, the system is not safe to ship.

## Current proof boundary

The current tests prove the recovery matrix in model form:

- failure before mutation
- failure after staging
- failure after dependency validation
- completed replay
- stale completed replay
- blocked partial recovery

That proof is necessary, but it is still not sufficient for production until the same boundary is enforced by durable storage.
