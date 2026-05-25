# Atomic Apply Recovery States

The atomic apply path only accepts three post-failure outcomes:

- `old-remote`: no remote mutation escaped the failure boundary.
- `fully-updated-remote`: the plan was already completed and replayed without reapplying mutations.
- `blocked-recovery`: the remote may be partially updated, but the failure is paired with a recovery artifact that explains the state.

The acceptable recovery artifact is a journal that can be replayed or inspected later. A partial remote mutation without a durable recovery artifact is a release blocker.

Replay behavior must stay idempotent:

- reapplying a completed plan must not duplicate inserts;
- reapplying a completed plan must not resurrect stale local data;
- a completed journal replay only reports `fully-updated-remote` when the current remote still matches the journaled after hashes.

The failure boundaries before mutation, after staging, and after dependency validation remain `old-remote` only when they carry a journal artifact; any partial remote mutation without a durable recovery artifact is a release blocker.
