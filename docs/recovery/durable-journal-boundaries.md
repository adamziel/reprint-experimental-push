# Durable Journal Boundaries

The atomic apply path has two kinds of evidence:

- in-memory JSON fixtures used by tests, model checks, and recovery inspection
- durable journal records written to storage and meant to survive process restarts

They serve different purposes. The JSON-model evidence is useful for tests and
recovery inspection; the durable journal is the production-shaped artifact that
must survive restarts and let a later inspector classify the outcome without
guessing from local state.

Fixture evidence is acceptable for proving the model in unit tests and for
describing recovery behavior in docs. It is not enough to claim production
safety unless the durable path also records the same boundary transitions to a
durable sink.

## Acceptable post-failure states

Every failure or replay must end in one of these states:

1. `old-remote`
   - No remote mutation escaped the failure boundary.
   - A recovery artifact may exist and should explain why apply stopped.
   - Safe retry must reuse the artifact rather than infer state from local data.

2. `fully-updated-remote`
   - The full plan is already present on the remote.
   - Replay must be idempotent and must not duplicate inserts or resurrect stale
     local data.
   - A completed journal replay is only acceptable if the remote still matches
     the journaled after hashes.

3. `blocked-recovery`
   - The remote may be partially updated, or the journal may be incomplete or
     inconsistent.
   - Recovery artifacts are required.
   - Retry must fail closed until fresh recovery evidence proves the site is
     safe.

Anything outside those states is a recovery bug. A partial remote mutation
without a recovery artifact is a release blocker, even if a later retry would
appear to succeed.

## Production durability requirements

For a production-safe recovery journal, the durable path must preserve enough
evidence to classify the outcome later:

- `journal-opened` and `target-planned` for pre-mutation failures
- `apply-staged` and `dependencies-validated` for pre-commit failures that were
  observed after staging or validation
- `journal-completed` or `journal-replayed` for completed plans
- `recovery-state` for failures that need a terminal classification written to
  disk

That evidence has to survive the process boundary. In practice that means the
implementation needs a durable append/write path, not just an in-memory object:

- records must be flushed to persistent storage
- the journal file or row must be left in a replayable state after restart
- a partial remote mutation without a matching durable recovery artifact is a
  release blocker

The production journal may be implemented with files, database rows, or another
durable sink, but the post-failure classification requirements do not change.
The implementation details can vary, but the safety bar does not:

- file-backed journals need an actual flush to stable storage, not just an
  in-memory append
- row-backed journals need a committed row that survives restart and can be
  inspected later
- plugin activation or other external side effects need their own durable
  evidence when they affect the recovery boundary
- leases, fencing tokens, or similar exclusion mechanisms are required when a
  second writer could otherwise replay stale work
- recovery inspect must be able to classify the result from artifacts alone,
  without guessing from the local working copy

If a remote mutation is visible but there is no durable recovery artifact that
can explain the state, treat that as a release blocker.

## Model evidence versus durable evidence

The test suite can prove the recovery contract with in-memory JSON fixtures and
inspection helpers, but that only establishes the model. Production safety
requires the same boundary states to survive restart in durable storage.

Use the JSON model to prove:

- `old-remote` stays old, even when failure happens before mutation, after
  staging, or after dependency validation
- `fully-updated-remote` replay stays idempotent and does not duplicate inserts
  or revive stale local data
- `blocked-recovery` always carries artifacts that explain the partial state

Use the durable journal to prove the same states are recoverable after process
exit. If the durable path cannot preserve the recovery artifact, the model
result is not enough to ship.

## Boundary matrix

| Failure boundary | Required state | Required artifacts |
| --- | --- | --- |
| before mutation | `old-remote` | opened journal plus the staged plan envelope |
| after staging | `old-remote` | staged journal evidence plus no committed remote mutation |
| after dependency validation | `old-remote` | dependencies-validated journal evidence plus no committed remote mutation |
| completed-plan replay | `fully-updated-remote` | completed journal envelope only, with zero new mutations |
| partial or drifted replay | `blocked-recovery` | completed journal plus remote drift evidence |

The matrix above is intentionally strict. If the remote changed but the recovery
artifact does not explain the change, the lane must treat that as blocked
recovery rather than a safe retry.
