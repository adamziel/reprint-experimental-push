# Durable Journal Production Notes

The atomic apply model in this lane treats the recovery journal as the
authoritative crash-recovery artifact, but the JSON fixtures and in-memory
replay checks only prove the shape of the contract.

Production recovery still needs durable storage semantics:

- journal rows or files must be written durably, not just constructed in memory
- recovery writes must survive process death, so flush/fsync semantics matter
- writers need fencing or lease semantics so stale retries cannot win after a
  newer claim exists
- recovery inspection must preserve enough artifact state to diagnose a blocked
  partial write

Acceptable post-failure states remain only these:

- `old-remote`: the remote stayed on the pre-apply side of the failure
  boundary
- `fully-updated-remote`: the whole plan was already committed and replay is
  inert
- `blocked-recovery`: the remote drifted or partially applied state needs
  recovery artifacts before retry

Recovery outcomes are only acceptable when they map to one of these evidence
sets:

- `old-remote`: no remote mutation escaped the boundary, and the journal can
  explain why the apply stopped
- `fully-updated-remote`: replay observed a completed plan and did not
  duplicate inserts or reapply stale local data
- `blocked-recovery`: the remote is ambiguous or partially applied, but the
  journal and remote artifacts are both preserved for inspection

Anything that leaves a partial remote mutation without a durable recovery
artifact is a release blocker.
