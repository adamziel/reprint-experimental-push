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
fixtures. The current default is 510 cases, with a hard minimum of 300. Cases
span 10 complexity tiers and 51 scenario families, then add seeded variation so
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

- 510 total cases;
- 10 tiers, 51 cases per tier;
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
  `wp_comments` + `wp_commentmeta` graph cases with per-tier target counts and
  ready/stale non-ready outcomes, `wp_terms` + `wp_termmeta` graph cases
  with per-tier target counts and ready/stale non-ready outcomes, `wp_users`
  + `wp_usermeta` graph cases with per-tier target counts and
  ready/stale non-ready outcomes, `wp_term_taxonomy` graph cases with per-tier
  target counts and ready/stale non-ready outcomes, plugin-owned `wp_options`
  update cases with ready/conflict outcomes and stale replay rejection before
  mutation, `wp_comments.user_id` author cases with
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


The `wpCommentsCommentmetaGraph` target coverage records per-tier counts for
generated `wp_comments` rows and their `wp_commentmeta` graph relationships.
Ready cases create the comment and commentmeta row in one plan and reject stale
replays before mutation; stale cases keep the comment in the base, drift that
comment remotely, and require the new commentmeta reference to fail closed
instead of overwriting the drifted remote.


The `wpTermsTermmetaGraph` target coverage records per-tier counts for generated
`wp_terms` rows and their `wp_termmeta` graph relationships. Ready cases create
the term and termmeta row in one plan and reject stale replays before mutation;
stale cases keep the term in the base, drift that term remotely, and require
the new termmeta reference to fail closed instead of overwriting the drifted
remote.

The `wpUsersUsermetaGraph` target coverage records per-tier counts for
generated `wp_users` rows and their `wp_usermeta` graph relationships. Ready
cases create the user and usermeta row in one plan and reject stale replays
before mutation; stale cases keep the user in the base, drift that user
remotely, and require the new usermeta reference to fail closed instead of
overwriting the drifted remote.

The `wpTermTaxonomyGraph` target coverage records per-tier counts for generated
`wp_term_taxonomy` rows and their `wp_terms` graph relationships. Ready cases
create the term and taxonomy row in one plan and reject a stale replay before
mutation; stale cases keep the term in the base, drift that term remotely, and
require the new taxonomy reference to fail closed instead of overwriting the
drifted remote.


The `pluginOwnedOptionChange` target coverage records per-tier counts for
generated plugin-owned `wp_options` rows using the supported forms driver.
Ready cases apply the local option update with owner/driver evidence and reject
stale replays before mutation; conflict cases drift the same plugin-owned option
remotely and must refuse apply without losing the remote value.


The `staleRemoteAfterDryRun` target coverage records per-tier counts for ready
plans whose live-remote preconditions reject a stale remote replay before any
mutation. Zero-mutation ready plans are excluded because there is no planned
target to drift after dry-run.

The `commentUserGraph` target coverage records per-tier counts for generated
`wp_comments.user_id` author references. Ready cases create the user and comment
in one plan and reject a stale replay before mutation; stale cases keep the user
in the base, drift that user remotely, and require the comment reference to fail
closed with hash-only target evidence.

At the time this note was added, the summary command reported:

```json
{
  "totalCases": 510,
  "statuses": {
    "blocked": 41,
    "conflict": 210,
    "ready": 259
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
        "ready": 10
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
    "pluginOwnedOptionChange": {
      "family": "plugin-owned-option-change-ready",
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
    "staleRemoteAfterDryRun": {
      "family": "ready-plan-stale-remote-after-dry-run",
      "total": 256,
      "perTier": {
        "0": 25,
        "1": 28,
        "2": 28,
        "3": 28,
        "4": 28,
        "5": 28,
        "6": 28,
        "7": 28,
        "8": 20,
        "9": 15
      },
      "statuses": {
        "ready": 256
      }
    },
    "wpCommentsCommentmetaGraph": {
      "family": "wp-comments-commentmeta-graph-ready",
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
        "blocked": 3,
        "conflict": 8,
        "ready": 9
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
        "conflict": 10,
        "ready": 10
      }
    },
    "wpTermsTermmetaGraph": {
      "family": "wp-terms-termmeta-graph-ready",
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
        "blocked": 3,
        "conflict": 8,
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
        "blocked": 4,
        "conflict": 6,
        "ready": 10
      }
    },
    "wpUsersUsermetaGraph": {
      "family": "wp-users-usermeta-graph-ready",
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
        "blocked": 3,
        "conflict": 7,
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
    "commentmeta-comment-graph": 20,
    "file-type-swap": 20,
    "file-type-swap-ready": 10,
    "file-type-swap-conflict": 10,
    "plugin-owned-option-change": 20,
    "plugin-owned-option-change-ready": 10,
    "plugin-owned-option-change-conflict": 10,
    "plugin-owned-option-update": 20,
    "plugin-owned-supported": 382,
    "row-create-update-delete-mix": 20,
    "row-create-update-delete-mix-ready": 10,
    "row-create-update-delete-mix-conflict": 10,
    "scalar-option-number": 10,
    "scalar-option-string": 10,
    "scalar-option-update": 20,
    "serialized-option-array": 10,
    "serialized-option-object": 10,
    "serialized-option-update": 20,
    "wp-comments-commentmeta-graph": 20,
    "wp-comments-commentmeta-graph-ready": 10,
    "wp-comments-commentmeta-graph-stale": 10,
    "wp-comments-create": 40,
    "wp-comments-remote-drift": 10,
    "wp-commentmeta-create": 20,
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
    "wp-terms-termmeta-graph": 20,
    "wp-terms-termmeta-graph-ready": 10,
    "wp-terms-termmeta-graph-stale": 10,
    "wp-termmeta-create": 20,
    "wp-users-usermeta-graph": 20,
    "wp-users-usermeta-graph-ready": 10,
    "wp-users-usermeta-graph-stale": 10,
    "wp-users-create": 40,
    "wp-usermeta-create": 20,
    "wp-users-remote-drift": 20,
    "wp-term-taxonomy-graph": 20,
    "wp-term-taxonomy-graph-ready": 10,
    "wp-term-taxonomy-graph-stale": 10,
    "wp-term-taxonomy-create": 20,
    "wp-terms-create": 40,
    "wp-terms-remote-drift": 20
  },
  "maxResourceCount": 70,
  "maxMutationCount": 45,
  "maxReadyResourceCount": 70,
  "maxReadyMutationCount": 45
}
```

## Extension Rule

Add new scenario families or seeded operations when a new Reprint push behavior
is needed. Do not add one-off expected snapshots for a single case unless the
case exposes a reusable generator capability. If a case needs an exact fixture,
it belongs in a narrow regression test beside the generated harness, not inside
the harness itself.
