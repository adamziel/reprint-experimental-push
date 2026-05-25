# Durable journal: lab model vs production recovery

The recovery tests in this lane use JSON fixtures and in-memory inspection to
prove the apply contract. That is useful for validating behavior, but it is not
the same as production durability.

The production rule is narrower: a failed apply must end in exactly one of
these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

The lab model is allowed to use cloned objects, synthetic failures, and
in-memory journal inspection to prove those states. Production recovery must
prove the same outcomes with durable storage primitives, not just test data.

## What the lab model proves

- failure before mutation returns `old-remote`
- failure after staging returns `old-remote`
- failure after dependency validation returns `old-remote`
- replay of a completed plan returns `fully-updated-remote`
- stale replay and partial commit return `blocked-recovery`

## What production still needs

For a real durable recovery journal, the implementation needs:

- journal rows or files that survive process exit
- flush and sync semantics so the journal is actually durable
- activation, locking, or lease fencing so only one writer can advance the
  recovery state
- restart-readable recovery metadata for inspection without replaying the plan
- a blocked partial mutation artifact that survives restart and explains why the
  remote is not safe to treat as current
- replay-safe completed-plan artifacts that let a retried apply stay inert
- enough evidence to classify mid-apply failures as blocked rather than
  reusing a partial remote write as if it were complete

## Release blocker rule

A partial remote mutation without inspectable recovery artifacts is unsafe.
If the remote changed and the recovery state cannot be classified from durable
artifacts, the system must stay blocked until recovery inspection resolves it.

In practical terms, a durable journal must let recovery distinguish:

- `old-remote` after failures before mutation, after staging, or after
  dependency validation
- `fully-updated-remote` when a completed plan is replayed and no new mutation
  work is needed
- `blocked-recovery` when a mid-apply partial write or drifted completed replay
  needs inspection before retry

## Durable evidence needed in production

The production journal needs durable evidence that can survive restart and be
inspected without guessing:

- DB rows or files for the journal itself
- `fsync` or equivalent flush semantics for those rows or files
- plugin activation and writer fencing so one writer owns the apply boundary
- a recovery inspect path that classifies the remote as `old-remote`,
  `fully-updated-remote`, or `blocked-recovery`
- blocked artifacts that keep the partial remote state explainable
- completed replay artifacts that keep retry inert
