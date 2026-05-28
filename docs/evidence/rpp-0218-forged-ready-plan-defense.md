# RPP-0218 forged ready plan defense evidence

## Scope

RPP-0218 adds an executor-side ready-plan envelope check before atomic
dependency validation, durable journal work, precondition checks, or mutation.
The defense rejects forged ready plans whose mutation/precondition evidence is
not one-to-one, and keeps stale ready plan refusals hash-only.

## Focused invariant

The focused fixture in `test/push-planner.test.js` builds a normal ready plan
with two local mutations, then exercises two refusal paths:

- a forged ready plan with one live-remote precondition removed, and
- a stale ready plan where the live remote file changed after planning.

Expected evidence:

- forged ready plans fail with `PLAN_INVARIANT_VIOLATION` before durable journal
  events or mutation,
- the invariant issue records only mutation id, resource key, and hash metadata,
- stale ready plans fail with `PRECONDITION_FAILED` before mutation,
- both refusal paths leave the remote snapshot unchanged, and
- refusal evidence omits raw local or remote private values.

## Verification command

```sh
node --test test/push-planner.test.js
```

Caveat: this is a focused local Node planner/apply invariant proof; release
status remains governed by the broader release gates.
