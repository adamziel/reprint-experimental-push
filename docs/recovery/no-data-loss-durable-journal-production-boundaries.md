# No Data Loss Durable Journal Production Boundaries

This lane treats durable recovery as a production contract, not just a JSON
fixture exercise. The recovery model is acceptable only when every failure path
lands in one of these states:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with artifacts

Anything else is a release blocker.

## What The Lab Proves

The current tests prove the recovery envelope with in-memory sites and
append-only JSON journal records:

- failure before mutation
- failure after staging
- failure after dependency validation
- failure during commit
- replay of a completed plan
- stale completed replay that must block instead of duplicating inserts or
  reviving stale local data

That is enough to validate the model, but it is not enough to claim production
durability.

The acceptable post-failure states are still only:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

The first three boundaries above must stay `old-remote`. A completed replay
must stay `fully-updated-remote`. Any partial remote mutation without
inspectable recovery artifacts is a release blocker.

## What Production Must Provide

Production recovery needs the same state machine, plus durable evidence:

- database rows or files that survive process death
- fsync or equivalent flush guarantees for the journal medium
- plugin activation or ownership checks that remain valid on retry
- fencing or lease checks that prevent stale writers from appending recovery
  evidence after a newer claim exists
- inspectable recovery artifacts so operators can classify the remote as old,
  fully updated, or blocked with proof
- a recovery inspect path that can explain why a replay is inert, blocked, or
  still requires operator intervention

If a mutation reaches the remote but there is no recovery artifact to explain
the outcome, the push is unsafe.

## Acceptable Failure Outcomes

`old-remote`

- No remote mutation has been committed.
- The recovery journal may contain opened or staged evidence, but no committed
  mutation evidence.
- Retrying must not invent inserts or stale local data.
- This is the only acceptable state for failures before mutation, after
  staging, and after dependency validation.

`fully-updated-remote`

- All planned mutations are present on the remote.
- The journal must already show the completed plan.
- Replaying the same completed plan must remain read-only and must not append
  fresh mutation evidence.
- Stale local state must not be resurrected during replay.
- A completed replay that already matches the remote should stay in this state
  even if the retry is repeated.

`blocked-recovery`

- The remote is partially updated or otherwise unsafe to classify as old or
  fully updated.
- The journal must keep the evidence needed to inspect the failure.
- The blocked state must retain remote and journal artifacts.
- A blocked recovery is the only acceptable answer when the remote changed and
  the journal cannot prove a safe replay or rollback.
- Any partial remote mutation without inspectable recovery artifacts is a
  release blocker, not an acceptable recovery state.

## Release Blocker

Treat these as blockers until the implementation proves otherwise:

- partial remote mutation without recovery artifacts
- replay that duplicates inserts
- replay that revives stale local data
- stale recovery claim that can still mutate the remote

## Next Boundary To Prove

The next useful test boundary is any path where the journal is durable but the
apply step loses its claim or storage context between staging and commit. That
boundary should still classify into the same three acceptable states above.
