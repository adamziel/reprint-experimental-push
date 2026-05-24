# Durable Journal Boundaries

The atomic apply path has two kinds of evidence:

- in-memory JSON fixtures used by tests and recovery inspection
- durable journal records written to storage and meant to survive process restarts

They serve different purposes. A test fixture can prove the model, but it is not
enough to claim production safety unless the durable journal path also records
the recovery state.

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

## Production durability requirements

For a production-safe recovery journal, the durable path must preserve enough
evidence to classify the outcome later:

- `journal-opened` and `target-planned` for pre-mutation failures
- `apply-staged` and `dependencies-validated` for pre-commit failures that were
  observed after staging or validation
- `journal-completed` or `journal-replayed` for completed plans
- `recovery-state` for failures that need a terminal classification written to
  disk

If a remote mutation is visible but there is no durable recovery artifact that
can explain the state, treat that as a release blocker.

