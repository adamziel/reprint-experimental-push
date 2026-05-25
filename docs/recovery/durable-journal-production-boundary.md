# Durable Journal Production Boundary

The current no-data-loss recovery tests prove the recovery state machine in a
model-backed harness. They do not yet prove a crash-safe production journal.

## First executable boundary still missing

The next production release gate is the storage/recovery boundary where a live
push command can:

- append recovery records to durable storage
- fsync or flush those records with backend-appropriate semantics
- reopen the persisted journal after restart
- inspect the persisted journal without replaying fresh mutations
- fence stale writers so a superseded claim cannot advance recovery

Until that boundary exists, the recovery proof remains model-only even when the
tests show the right states.

## Release blocker

A partial remote mutation without inspectable recovery artifacts is a blocker.
The allowed post-failure states remain:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Anything outside that envelope must stop at the recovery boundary and keep the
journal and remote artifacts available for inspection.
