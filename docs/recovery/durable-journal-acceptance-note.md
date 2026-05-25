# Durable Journal Acceptance Note

This lane's recovery model is intentionally small:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The test suite in `test/push-planner.test.js` uses JSON fixtures and temporary
files to prove the model. That evidence is useful, but it is not the same as a
production recovery journal.

Production recovery still needs:

- append-only journal rows or files that survive process failure
- flush or `fsync`-equivalent durability for the journal and any recovery
  artifact writes
- fencing or claim ownership so only one writer advances recovery state
- restart-readable inspection data for old, fully updated, and blocked states

Recovery outcomes stay acceptable only when the durable journal can explain the
result:

- `old-remote` means the apply never became visible on the remote.
- `fully-updated-remote` means replay is inert and does not duplicate inserts
  or revive stale local data.
- `blocked-recovery` means the remote may be partially updated, but the journal
  also carries inspectable remote evidence.

A partial remote mutation without a durable recovery artifact is a release
blocker.
