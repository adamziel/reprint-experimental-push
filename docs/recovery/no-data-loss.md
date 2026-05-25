# No Data Loss Recovery Contract

This lane treats recovery as a durability contract, not just an in-memory
classification.

## Acceptable post-failure states

After an interrupted or failed apply, the remote must end up in one of these
states:

1. `old-remote`
   - No target mutation has been durably published.
   - The recovery journal may exist and may show an `opened`, `staged`, or
     `dependencies-validated` state.
   - A retry may reuse the durable journal to complete the original plan.

2. `fully-updated-remote`
   - Every planned mutation is already present on the remote.
   - The replay path must be inert and must not duplicate inserts or resurrect
     stale local data.
   - The durable journal should resolve to `completed`.

3. `blocked-recovery`
   - The remote cannot be proven to be purely old or purely updated.
   - The recovery artifact set must include the journal and the observed remote
     state that explains the block.
   - Any partial remote mutation without a durable recovery artifact is a release
     blocker.

## Retry rule

Retries are only safe when the durable journal proves one of the two replayable
states above.

- If the journal is replayable and the remote still matches the recorded
  before/after envelope, the apply path can finish the plan without fresh
  mutation work.
- If the remote has drifted outside that envelope, the result must stay
  `blocked-recovery`.
- A retry must never treat partial writes without artifacts as safe.

## Boundary coverage

The regression tests in `test/push-planner.test.js` currently pin:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan
- blocked partial recovery and stale replay inspection

Keep extending the model from the next untested recovery boundary rather than
loosening the contract.
