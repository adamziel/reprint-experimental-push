# RPP-0220 atomic group blocker propagation evidence

## Scope

RPP-0220 proves that a blocker on one resource in an atomic push intent
propagates to the other planned mutations in that same group. This makes the
planner evidence explicit that otherwise valid sibling mutations cannot be
applied independently when the atomic group is blocked.

## Focused invariant

The focused fixture in `test/push-planner.test.js` builds one atomic group with:

- one unsupported plugin-owned option row that creates a direct blocker,
- one local file mutation, and
- one local post row mutation.

Expected evidence:

- the plan and atomic group are `blocked`,
- the direct blocker keeps hash-only change evidence for the unsupported row,
- each sibling mutation has an `atomic-group-blocker-propagation` blocker that
  references the direct blocker id,
- propagated blocker evidence contains resource keys, mutation ids, group id,
  source blocker ids, and reason text without raw local values, and
- apply rejects with `PLAN_NOT_READY` before durable journal events or target
  mutation.

## Verification command

```sh
node --test test/push-planner.test.js
```

Caveat: this is a focused local Node planner/apply invariant proof; release
status remains governed by the broader release gates.
