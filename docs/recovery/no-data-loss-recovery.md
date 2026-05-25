# No Data Loss Recovery Contract

This lane treats every apply outcome as one of three acceptable states:

1. `old-remote`
   - No remote mutation is allowed to escape without a journal artifact.
   - The recovery payload must carry the journal snapshot that describes the interrupted plan.

2. `fully-updated-remote`
   - The remote already matches the completed plan.
   - The recovery payload must carry the completed journal artifact.
   - The replay path must stay inert and must not re-apply inserts or resurrect stale local data.

3. `blocked-recovery`
   - A partial commit or remote drift was observed.
   - The recovery payload must carry both journal and remote artifacts so inspection can continue.
   - This state is the only acceptable outcome for a partial remote mutation.

Release blocker rule:

- Any partial remote mutation without a recovery artifact is a blocker.
- Retry logic must not treat a partially written state as safe, and it must not duplicate inserts on replay.

Durable journal expectation:

- The durable journal should record the boundary that was reached before failure.
- Recovery inspection should be able to distinguish an untouched remote, a fully completed replay, and a blocked partial commit from persisted artifacts alone.
- A completed replay should be append-only: it records the replay boundary, does not re-stage mutations, and does not resurrect stale local inserts or edits.
