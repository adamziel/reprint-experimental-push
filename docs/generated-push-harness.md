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
fixtures. The current default is 430 cases, with a hard minimum of 300. Cases
span 10 complexity tiers and 43 scenario families, then add seeded variation so
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

- 430 total cases;
- 10 tiers, 43 cases per tier;
- ready, conflict, and blocked outcomes;
- tier-9 ready/apply cases;
- local edits, remote-only edits, independent merge, same independent content,
  deletes, delete/edit conflicts, file topology conflicts, file create/update/
  delete mixes with ready and conflicting outcomes, directory descendant
  conflicts with per-tier target counts, file type-swap cases with ready and
  conflicting outcomes, row create/update/delete mixes with ready and conflicting
  outcomes plus stale replay rejection before mutation, non-plugin-owned
  `wp_options` scalar and serialized option updates with ready and
  concurrent remote-drift outcomes, `wp_posts`
  create/update/delete mixes with per-tier target counts and ready/conflict
  outcomes, `wp_postmeta` create/update/delete mixes with per-tier target
  counts, ready/conflict outcomes, and stale replay rejection before mutation,
  `wp_term_taxonomy` graph cases with per-tier target counts and
  ready/stale non-ready outcomes, `wp_comments.user_id` author cases with
  per-tier ready/stale target counts and hash-only stale-user blockers,
  supported and unsupported plugin-owned data, plugin owner-context drift,
  supported forms-lab custom-table rows, forms-lab delete refusal, atomic plugin
  install ready and missing-dependency paths, same-plan post-parent, taxonomy,
  comment, and usermeta graph closures, and stale graph references.

The `wpOptionsScalar` surface seeds regular, non-plugin-owned `wp_options` rows
with scalar string and number values. Ready cases update the scalar option while
preserving the live remote; conflict cases drift the same option remotely and
must refuse apply without plugin-owner evidence.

The `wpOptionsSerialized` surface seeds regular, non-plugin-owned `wp_options`
rows with structured array and object values. Ready cases update the serialized
option while preserving the live remote; conflict cases drift the same option
remotely and must refuse apply without plugin-owner evidence.

The `wpPostsCreateUpdateDelete` target coverage records per-tier counts for the
`wp_posts` create/update/delete surface. Its invariant is that ready cases apply
only the planned post create, update, and delete while preserving every
unplanned remote resource; concurrent remote edits to the updated post remain
`conflict` and refuse apply.

The `wpPostmetaCreateUpdateDelete` target coverage records per-tier counts for
the `wp_postmeta` create/update/delete surface. Its invariant is that ready
cases apply only the planned postmeta create, update, and delete while
preserving every unplanned remote resource; stale replays fail before mutation,
and concurrent remote edits to the updated postmeta row remain `conflict` and
refuse apply.

The `wpTermTaxonomyGraph` target coverage records per-tier counts for generated
`wp_term_taxonomy` rows and their `wp_terms` graph relationships. Ready cases
create the term and taxonomy row in one plan and reject a stale replay before
mutation; stale cases keep the term in the base, drift that term remotely, and
require the new taxonomy reference to fail closed instead of overwriting the
drifted remote.

The `commentUserGraph` target coverage records per-tier counts for generated
`wp_comments.user_id` author references. Ready cases create the user and comment
in one plan and reject a stale replay before mutation; stale cases keep the user
in the base, drift that user remotely, and require the comment reference to fail
closed with hash-only target evidence.

At the time this note was added, the summary command reported:

```json
{
  "totalCases": 430,
  "statuses": {
    "blocked": 34,
    "conflict": 164,
    "ready": 232
  },
  "targetCoverage": {
    "commentUserGraph": {
      "family": "comment-user-graph-ready",
      "total": 20,
      "perTier": {
        "0": 2,
        "1": 2,
        "2": 2,
        "3": 2,
        "4": 2,
        "5": 2,
        "6": 2,
        "7": 2,
        "8": 2,
        "9": 2
      },
      "statuses": {
        "blocked": 10,
        "conflict": 1,
        "ready": 9
      }
    },
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
      "total": 20,
      "perTier": {
        "0": 2,
        "1": 2,
        "2": 2,
        "3": 2,
        "4": 2,
        "5": 2,
        "6": 2,
        "7": 2,
        "8": 2,
        "9": 2
      },
      "statuses": {
        "conflict": 10,
        "ready": 10
      }
    },
    "wpPostsCreateUpdateDelete": {
      "family": "wp-posts-create-update-delete-ready",
      "total": 20,
      "perTier": {
        "0": 2,
        "1": 2,
        "2": 2,
        "3": 2,
        "4": 2,
        "5": 2,
        "6": 2,
        "7": 2,
        "8": 2,
        "9": 2
      },
      "statuses": {
        "conflict": 11,
        "ready": 9
      }
    },
    "wpTermTaxonomyGraph": {
      "family": "wp-term-taxonomy-graph-ready",
      "total": 20,
      "perTier": {
        "0": 2,
        "1": 2,
        "2": 2,
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
        "conflict": 8,
        "ready": 10
      }
    }
  },
  "featureFamilies": {
    "comment-user": 20,
    "comment-user-graph": 20,
    "comment-user-graph-ready": 10,
    "comment-user-graph-stale": 10,
    "comment-user-ready": 10,
    "comment-user-stale-target": 10,
    "file-type-swap": 20,
    "file-type-swap-ready": 10,
    "file-type-swap-conflict": 10,
    "row-create-update-delete-mix": 20,
    "row-create-update-delete-mix-ready": 10,
    "row-create-update-delete-mix-conflict": 10,
    "scalar-option-number": 10,
    "scalar-option-string": 10,
    "scalar-option-update": 20,
    "serialized-option-array": 10,
    "serialized-option-object": 10,
    "serialized-option-update": 20,
    "wp-comments-create": 20,
    "wp-options-scalar": 20,
    "wp-options-scalar-ready": 10,
    "wp-options-scalar-conflict": 10,
    "wp-options-serialized": 20,
    "wp-options-serialized-ready": 10,
    "wp-options-serialized-conflict": 10,
    "wp-postmeta-create": 20,
    "wp-postmeta-create-update-delete": 20,
    "wp-postmeta-create-update-delete-ready": 10,
    "wp-postmeta-create-update-delete-conflict": 10,
    "wp-postmeta-delete": 20,
    "wp-postmeta-update": 20,
    "wp-posts-create-update-delete": 20,
    "wp-posts-create-update-delete-ready": 10,
    "wp-posts-create-update-delete-conflict": 10,
    "wp-term-taxonomy-graph": 20,
    "wp-term-taxonomy-graph-ready": 10,
    "wp-term-taxonomy-graph-stale": 10,
    "wp-term-taxonomy-create": 20,
    "wp-terms-create": 20,
    "wp-terms-remote-drift": 10,
    "wp-users-create": 20,
    "wp-users-remote-drift": 10
  },
  "maxResourceCount": 77,
  "maxMutationCount": 52,
  "maxReadyResourceCount": 77,
  "maxReadyMutationCount": 52
}
```

## Extension Rule

Add new scenario families or seeded operations when a new Reprint push behavior
is needed. Do not add one-off expected snapshots for a single case unless the
case exposes a reusable generator capability. If a case needs an exact fixture,
it belongs in a narrow regression test beside the generated harness, not inside
the harness itself.
