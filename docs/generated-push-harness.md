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
span 10 complexity tiers and 37 scenario families, then add seeded variation so
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
  delete mixes with ready and conflicting outcomes, directory descendant
  conflicts with per-tier target counts, file type-swap cases with ready and
  conflicting outcomes, row create/update/delete mixes with ready and conflicting
  outcomes plus stale replay rejection before mutation, `wp_posts`
  create/update/delete mixes with per-tier target counts and ready/conflict
  outcomes, `wp_postmeta` create/update/delete mixes with per-tier target counts
  and ready/conflict outcomes, `wp_term_taxonomy` graph cases with per-tier
  target counts and ready/stale non-ready outcomes, supported and unsupported
  plugin-owned data, plugin owner-context drift, supported forms-lab custom-table
  rows, forms-lab delete refusal, atomic plugin install ready and
  missing-dependency paths, same-plan post-parent, taxonomy, comment, and
  usermeta graph closures, and stale graph references.

The `wpPostsCreateUpdateDelete` target coverage records per-tier counts for the
`wp_posts` create/update/delete surface. Its invariant is that ready cases apply
only the planned post create, update, and delete while preserving every
unplanned remote resource; concurrent remote edits to the updated post remain
`conflict` and refuse apply.

The `wpPostmetaCreateUpdateDelete` target coverage records per-tier counts for
`wp_postmeta` create/update/delete rows that reference existing posts. Its
invariant is that ready cases apply only the planned meta create, update, and
delete while preserving every unplanned remote resource, reject stale replay
before mutation, and keep meta values redacted to hash metadata. Concurrent
remote edits to the updated meta row remain `conflict`, omit a mutation for the
conflicted row, and refuse apply before mutation.

The `wpTermTaxonomyGraph` target coverage records per-tier counts for generated
`wp_term_taxonomy` rows and their `wp_terms` graph relationships. Ready cases
create the term and taxonomy row in one plan and reject a stale replay before
mutation; stale cases keep the term in the base, drift that term remotely, and
require the new taxonomy reference to fail closed instead of overwriting the
drifted remote.

At the time this note was added, the summary command reported:

```json
{
  "totalCases": 360,
  "statuses": {
    "blocked": 23,
    "conflict": 146,
    "ready": 191
  },
  "targetCoverage": {
    "directoryDescendantConflict": {
      "family": "directory-descendant-conflict",
      "total": 10,
      "perTier": {
        "0": 1,
        "1": 1,
        "2": 1,
        "3": 1,
        "4": 1,
        "5": 1,
        "6": 1,
        "7": 1,
        "8": 1,
        "9": 1
      },
      "statuses": {
        "conflict": 10
      }
    },
    "wpPostmetaCreateUpdateDelete": {
      "family": "wp-postmeta-create-update-delete-ready",
      "total": 18,
      "perTier": {
        "0": 2,
        "1": 2,
        "2": 2,
        "3": 1,
        "4": 1,
        "5": 2,
        "6": 2,
        "7": 2,
        "8": 2,
        "9": 2
      },
      "statuses": {
        "conflict": 9,
        "ready": 9
      }
    },
    "wpPostsCreateUpdateDelete": {
      "family": "wp-posts-create-update-delete-ready",
      "total": 18,
      "perTier": {
        "0": 2,
        "1": 2,
        "2": 2,
        "3": 2,
        "4": 2,
        "5": 1,
        "6": 1,
        "7": 2,
        "8": 2,
        "9": 2
      },
      "statuses": {
        "conflict": 10,
        "ready": 8
      }
    },
    "wpTermTaxonomyGraph": {
      "family": "wp-term-taxonomy-graph-ready",
      "total": 18,
      "perTier": {
        "0": 2,
        "1": 1,
        "2": 1,
        "3": 2,
        "4": 2,
        "5": 2,
        "6": 2,
        "7": 2,
        "8": 2,
        "9": 2
      },
      "statuses": {
        "blocked": 2,
        "conflict": 7,
        "ready": 9
      }
    }
  },
  "featureFamilies": {
    "file-type-swap": 19,
    "file-type-swap-ready": 10,
    "file-type-swap-conflict": 9,
    "row-create-update-delete-mix": 18,
    "row-create-update-delete-mix-ready": 9,
    "row-create-update-delete-mix-conflict": 9,
    "wp-postmeta-create-update-delete": 18,
    "wp-postmeta-create-update-delete-ready": 9,
    "wp-postmeta-create-update-delete-conflict": 9,
    "wp-postmeta-create": 18,
    "wp-postmeta-update": 18,
    "wp-postmeta-delete": 18,
    "wp-posts-create-update-delete": 18,
    "wp-posts-create-update-delete-ready": 9,
    "wp-posts-create-update-delete-conflict": 9,
    "wp-term-taxonomy-graph": 18,
    "wp-term-taxonomy-graph-ready": 9,
    "wp-term-taxonomy-graph-stale": 9,
    "wp-term-taxonomy-create": 18,
    "wp-terms-create": 18,
    "wp-terms-remote-drift": 9
  },
  "maxResourceCount": 69,
  "maxMutationCount": 44,
  "maxReadyResourceCount": 69,
  "maxReadyMutationCount": 44
}
```

## Extension Rule

Add new scenario families or seeded operations when a new Reprint push behavior
is needed. Do not add one-off expected snapshots for a single case unless the
case exposes a reusable generator capability. If a case needs an exact fixture,
it belongs in a narrow regression test beside the generated harness, not inside
the harness itself.
