# Durable Journal Production Evidence

Lab tests can prove the recovery model with in-memory JSON fixtures, but production no-data-loss recovery needs stronger evidence:

- a durable journal record on disk or in the database
- a fenced writer or equivalent lease so only one recovery actor can advance the journal
- fsync or equivalent persistence guarantees for journal and artifact writes
- replay-safe recovery metadata that can distinguish `old-remote`, `fully-updated-remote`, and `blocked-recovery`

The acceptable post-failure states are narrow:

1. `old-remote`
   - nothing has been mutated remotely
   - the journal may show an opened or staged boundary, but the remote must still match the original state

2. `fully-updated-remote`
   - all planned mutations are present remotely
   - completed replay must stay inert and must not duplicate inserts or resurrect stale local data
   - the journal must prove the plan was already completed

3. `blocked-recovery`
   - the remote is partially advanced or has drifted outside the before/after envelope
   - recovery artifacts must be preserved so an operator can inspect what happened
   - a partial remote mutation without recovery artifacts is a release blocker

What is not enough in production:

- an in-memory JSON transcript without durable writes
- a journal record without fsync or equivalent durability
- a replay result that claims safety without preserving the recovery artifacts
- retry logic that treats a partial write as if it were a completed plan

Use this doc as the production checklist and the other recovery notes as the model and test matrix.
