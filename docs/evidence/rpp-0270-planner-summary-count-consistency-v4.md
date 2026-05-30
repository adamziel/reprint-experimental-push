# RPP-0270 planner summary count consistency v4

Status: focused local regression coverage added for variant 4. Release remains gated by the broader integration lane.

## Scenario

`test/rpp-0270-planner-summary-count-consistency-v4.test.js` adds a standalone focused planner proof, separate from the generated harness. It covers ready, conflict, blocked, ready atomic, and blocked atomic propagation plans.

For every fixture, `plan.summary` must equal the emitted planner evidence counts for mutations, decisions, conflicts, blockers, and atomic groups. The proof also requires live-remote preconditions to remain one-for-one with emitted mutations, then replans cloned snapshots to confirm the summary evidence envelope is deterministic.

## Progress log

Command:

```sh
node --test test/rpp-0270-planner-summary-count-consistency-v4.test.js
```

Caveat: this is a local deterministic Node focused planner proof. It does not use the generated harness, does not update release status, and does not replace the broader release checklist or CI evidence.

## Focused surface

- Ready mixed fixture: two mutations plus one keep-remote decision.
- Conflict fixture: one safe mutation, one keep-remote decision, and one conflict.
- Blocked fixture: one safe mutation, one keep-remote decision, and one unsupported plugin-owned resource blocker.
- Ready atomic fixture: two grouped mutations and one ready atomic group.
- Blocked atomic fixture: two grouped mutations, one unsupported plugin-owned resource blocker, two propagated atomic blockers, and one blocked atomic group.
