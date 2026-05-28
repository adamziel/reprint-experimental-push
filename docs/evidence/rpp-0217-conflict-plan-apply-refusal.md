# RPP-0217 conflict plan apply refusal evidence

## Scope

RPP-0217 proves that a non-ready conflict plan is rejected by the executor before
any mutation can be staged or journaled, even when the plan also carries an
otherwise valid independent local mutation.

## Focused invariant

The focused fixture in `test/push-planner.test.js` creates:

- one independent local file mutation with a live remote precondition,
- one divergent local/remote row edit that plans as `row-conflict`, and
- a durable-journal trap that would record any executor work after the status
  gate.

Expected evidence:

- `plan.status` is `conflict`.
- `plan.summary` is deterministic and matches emitted mutations, decisions,
  conflicts, blockers, and atomic groups.
- The conflicting resource emits no mutation and no precondition.
- Conflict evidence records hashes, resource keys, class, and resolution policy
  without raw row values.
- `applyPlan()` rejects with stable `PLAN_NOT_READY` details before durable
  journal events or target mutation.

## Verification command

```sh
node --test test/push-planner.test.js
```

Caveat: this is a local Node planner/apply invariant proof; release status is
still governed by the broader release gates.
