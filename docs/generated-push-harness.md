# Generated Push Harness

Checked command:

```sh
npm run test:generated-push-harness
```

Direct summary command:

```sh
node scripts/harness/generated-push-cases.js
```

## Purpose

This harness generates deterministic Reprint push cases instead of exact-shaped
fixtures. The current default is 360 cases, with a hard minimum of 300. Cases
span 10 complexity tiers and 26 scenario families, then add seeded variation so
the planner and executor see mixed file, row, plugin-owned, graph, atomic,
delete, conflict, and remote-preservation surfaces.

The goal is not to bless a few named fixtures. The goal is to keep expanding a
general Reprint push contract where every generated case must satisfy the same
invariants:

- plan summaries match the actual mutation, decision, conflict, blocker, and
  atomic-group arrays;
- every mutation has a matching live-remote precondition whose hash matches the
  current remote resource;
- ready plans apply only planned local values and preserve every unplanned
  remote resource;
- ready plans reject stale remotes before mutation;
- non-ready plans refuse apply and leave the remote unchanged;
- conflicts and blockers do not still carry mutations for the same blocked or
  conflicted resource;
- plugin-owned mutations carry explicit owner and driver evidence.

## Current Coverage

The default generated run covers:

- 360 total cases;
- 10 tiers, 36 cases per tier;
- ready, conflict, and blocked outcomes;
- tier-9 ready/apply cases;
- local edits, remote-only edits, independent merge, same independent content,
  deletes, delete/edit conflicts, file topology conflicts, file create/update/
  delete mixes with ready and conflicting outcomes, supported and unsupported
  plugin-owned data, plugin owner-context drift, supported forms-lab custom-table
  rows, forms-lab delete refusal, atomic plugin install ready and missing-
  dependency paths, same-plan post-parent, taxonomy, comment, and usermeta graph
  closures, and stale graph references.

At the time this note was added, the summary command reported:

```json
{
  "totalCases": 360,
  "statuses": {
    "blocked": 26,
    "conflict": 133,
    "ready": 201
  },
  "maxResourceCount": 69,
  "maxMutationCount": 44,
  "maxReadyResourceCount": 68,
  "maxReadyMutationCount": 43
}
```

## Extension Rule

Add new scenario families or seeded operations when a new Reprint push behavior
is needed. Do not add one-off expected snapshots for a single case unless the
case exposes a reusable generator capability. If a case needs an exact fixture,
it belongs in a narrow regression test beside the generated harness, not inside
the harness itself.
