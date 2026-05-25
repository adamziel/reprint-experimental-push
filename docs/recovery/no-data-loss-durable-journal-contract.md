# Durable Journal Contract

The recovery model in this lane is only acceptable when the apply path can be
reconstructed from durable artifacts that survive interruption.

Accepted post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The important distinction is the artifact boundary, not whether a local replay
can be simulated in-memory.

## What each state requires

- `old-remote`
  - No remote mutation may be visible.
  - Durable journal evidence must explain where apply stopped.
- `fully-updated-remote`
  - All planned mutations are visible on the remote.
  - The completed replay must remain inert on retry.
- `blocked-recovery`
  - A partial remote mutation may exist only when the recovery artifacts are
    inspectable.
  - Both journal and remote artifacts must be available for recovery.

## Release blocker

A partial remote mutation without a durable recovery artifact is unsafe and is
a release blocker.

## Durable versus lab evidence

The in-memory model can prove the shape of the contract, but production recovery
must come from durable journal rows or files that survive a process crash.
That means the production path needs:

- journal rows or files that are fsynced or otherwise durably committed
- recovery inspect data that can classify the current state after interruption
- plugin activation or lease/fencing evidence when the apply path depends on
  ownership

Lab-only JSON evidence is useful for regression testing, but it is not a
substitute for durable recovery storage.
