# No Data Loss Recovery Contract

This lane treats atomic apply as a recovery protocol, not just a mutation step.

## Acceptable end states

Every apply attempt must end in one of these states:

- `old-remote`: nothing was committed to the remote, and the journal is the
  recovery artifact.
- `fully-updated-remote`: all planned mutations are present, and the journal is
  the recovery artifact.
- `blocked-recovery`: the remote may be partially updated, but the failure is
  fenced by inspectable artifacts.

## Release blockers

A partial remote mutation without a recovery artifact is a blocker.

Retry logic must not:

- duplicate inserts,
- resurrect stale local data,
- treat a partial write as if it were safe,
- reopen a completed plan that already matched the remote.

## Durable journal expectations

JSON fixtures and lab traces are useful evidence, but production recovery needs
durable journal records with inspectable state transitions.

The durable journal should preserve:

- the opened plan record,
- per-target planning records,
- boundary records for staging and validation,
- a final recovery-state or replay marker,
- inspectable artifacts for blocked recovery.

When a retry observes a completed plan, it must remain append-only and inert.
