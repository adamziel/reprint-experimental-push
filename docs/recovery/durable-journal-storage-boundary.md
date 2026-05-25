# Durable Journal Storage Boundary

The recovery model is already precise about the acceptable post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

What is still missing is the first executable storage boundary that can prove
those states after a real crash.

## Required boundary

The next implementation step must cross one of these concrete storage or
recovery-inspect edges:

- a durable journal row written to a database transaction log or row store
- a file-backed append log with flush semantics that survives process death
- a recovery-inspect command that reads the persisted artifact and classifies
  the remote without relying on in-memory plan state

## What must survive restart

The persisted trail must carry enough evidence to answer these questions after
an interruption:

- Did the remote stay `old-remote`?
- Did the plan finish and become `fully-updated-remote`?
- If neither is true, what artifacts prove `blocked-recovery`?

## Release gate

A partial remote mutation without a recovery artifact is still a release
blocker.

The implementation is not ready for release until the journal is durable,
restart-readable, and able to prove one of the approved recovery states
without guessing from local memory.
