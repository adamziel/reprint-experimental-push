# No Data Loss Recovery Contract

This lane treats recovery as a durable state machine, not just an in-memory
return value.

Acceptable post-failure states are limited to:

- `old-remote`: the remote must remain untouched, and the journal must carry
  recovery artifacts that explain why apply did not proceed.
- `fully-updated-remote`: the remote already matches every planned mutation,
  and replay must remain inert while recording a completed recovery artifact.
- `blocked-recovery`: the remote may be partially mutated, but only when the
  durable journal preserves enough artifacts to explain and inspect the
  partial state.

Rules:

1. A failure before mutation, after staging, or after dependency validation
   must never silently become a successful apply.
2. A replay of a completed plan must not duplicate inserts or resurrect stale
   local data.
3. Any partial remote mutation without a durable recovery artifact is a
   release blocker.
4. Recovery inspection should prefer proof from the durable journal over any
   transient in-memory state.

The durable journal is the source of truth for crash recovery. JSON fixtures
and lab-only evidence can describe the model, but production recovery must be
backed by append-only journal records, persisted files, and explicit recovery
state artifacts.
