# No Data Loss Recovery Boundary Checklist

This lane treats the atomic apply model as safe only when an interruption or
retry lands in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

The test model in `test/push-planner.test.js` uses JSON fixtures and in-memory
writers to prove the state machine. That is useful for recovery logic, but it is
not enough for a production deployment.

## Failure boundaries

- Failure before mutation must leave the remote unchanged and record an
  `old-remote` recovery state.
- Failure after staging must still leave the remote unchanged and record an
  `old-remote` recovery state.
- Failure after dependency validation must still leave the remote unchanged and
  record an `old-remote` recovery state.
- Replaying a completed plan against an already matching remote must be inert
  and report `fully-updated-remote`.
- Replaying a completed plan against drift must stop in `blocked-recovery` and
  preserve the recovery artifacts.

## Release blocker

A partial remote mutation without a durable recovery artifact is unsafe.

If the remote can be mutated in part, the journal must preserve enough evidence
to explain the visible state on retry. Otherwise the system stays blocked.

## Production requirements

Production recovery needs more than lab JSON state:

- durable journal rows or files that survive process failure
- flush or fsync semantics for the recovery trail
- claim fencing or lease ownership so only one writer advances the journal
- restart-readable recovery metadata for inspection without replay
- recovery inspect tooling that can read the preserved artifacts

