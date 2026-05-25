# Durable journal: lab model vs production recovery

The recovery tests in this lane use JSON fixtures and in-memory inspection to
prove the apply contract. That is useful for validating behavior, but it is not
the same as production durability.

The production rule is narrower: a failed apply must end in exactly one of
these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

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

## Release blocker rule

A partial remote mutation without inspectable recovery artifacts is unsafe.
If the remote changed and the recovery state cannot be classified from durable
artifacts, the system must stay blocked until recovery inspection resolves it.
