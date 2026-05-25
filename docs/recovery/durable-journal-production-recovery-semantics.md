# Durable Journal Production Recovery Semantics

The recovery model used in tests is allowed to be small and inspectable, but the
production contract is stricter:

- `old-remote` means the durable journal can prove that no committed remote
  mutation escaped the failure boundary.
- `fully-updated-remote` means the remote already matches the completed plan,
  and replay is inert.
- `blocked-recovery` means the remote is partially applied, drifted, or
  otherwise ambiguous, and the recovery bundle must include artifacts that make
  that state inspectable.

## Production Requirements

- The durable journal must survive process restarts and be replayable without
  trusting in-memory fixtures.
- Partial remote writes must never be treated as safe unless the journal and
  remote artifacts explain the state.
- Completed replay must not duplicate inserts or resurrect stale local data.
- Failures before mutation, after staging, and after dependency validation must
  still classify as `old-remote` when the journal can prove the remote stayed
  untouched.

## Lab Evidence

The test suite can use JSON fixtures and in-memory helpers to prove the model,
but those artifacts are evidence, not the production durability mechanism.
When recovery cannot prove one of the three accepted states, the result must be
`blocked-recovery` with inspectable artifacts.
