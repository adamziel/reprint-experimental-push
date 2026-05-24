# Durable Journal vs Lab Evidence

The recovery tests in this lane use in-memory JSON fixtures and temporary files
to prove the shape of the contract. That is useful for model coverage, but it is
not the same as production durability.

## Lab evidence

The test harness can prove:

- `old-remote` for failures before mutation, after staging, or after dependency validation
- `fully-updated-remote` for completed-plan replay that stays inert
- `blocked-recovery` for partial or ambiguous recovery with artifacts

Lab evidence is acceptable for regression tests because it can show the recovery
classification and verify that retries do not duplicate inserts or revive stale
local state.

## Production journal requirements

A production recovery journal still needs durable storage properties:

- append-only rows or files that survive process exit
- fsync or equivalent flush semantics for the journal write path
- claim fencing or activation so only one writer can advance recovery state
- restart-readable recovery metadata for inspection without replay

If any remote mutation is visible and the durable journal cannot explain it, the
result is not safe. The apply path must stay blocked until recovery artifacts
are inspectable.

## Acceptable end states

Every interrupted apply must land in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

A partial remote mutation without a recovery artifact is a release blocker.
