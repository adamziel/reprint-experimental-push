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
span 10 complexity tiers and 52 scenario families, then add seeded variation so
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
- conflicts and non-propagated blockers do not still carry mutations for the
  same blocked or conflicted resource;
- plugin-owned mutations carry explicit owner and driver evidence.

## Current Coverage

The default generated run covers:

- 510 total cases;
- 10 tiers, 51 cases per tier;
- ready, conflict, and blocked outcomes;
- tier-9 ready/apply cases;
- local edits, remote-only edits, independent merge, same independent content,
  large ready plan tiers with one ready case per tier, deletes, delete/edit
  conflicts, file topology conflicts, file create/update/
  delete mixes with ready and conflicting outcomes plus per-tier target counts,
  directory descendant deletes with ready and conflicting outcomes plus
  per-tier target counts, file type-swap cases with ready/conflict outcomes
  plus per-tier target counts, row create/update/delete mixes with
  ready/conflict outcomes plus per-tier target counts and stale replay rejection
  before mutation, non-plugin-owned `wp_options` scalar changes with per-tier
  target counts, serialized option changes with per-tier target counts and
  redacted hash-only evidence for private serialized payloads, `wp_posts`
  create/update/delete mixes with per-tier target counts and ready/conflict
  outcomes, `wp_postmeta` create/update/delete mixes with per-tier target
  counts, ready/conflict outcomes, and stale replay rejection before mutation,
  `wp_comments` + `wp_commentmeta` graph cases with per-tier target counts and
  ready/stale non-ready outcomes, `wp_terms` + `wp_termmeta` graph cases
  with per-tier target counts and ready/stale non-ready outcomes, `wp_users`
  + `wp_usermeta` graph cases with per-tier target counts and
  ready/stale non-ready outcomes, `wp_term_taxonomy` graph cases with per-tier
  target counts and ready/stale non-ready outcomes, `wp_term_relationships`
  graph cases with one target per tier, ready creates, stale taxonomy drift,
  and redacted hash-only evidence, plugin-owned `wp_options` update cases with
  ready/conflict outcomes and stale replay rejection before mutation,
  `wp_comments.user_id` author cases with
  per-tier ready/stale target counts and hash-only stale-user blockers,
  supported and unsupported plugin-owned data, plugin owner-context drift,
  supported forms-lab custom-table rows, forms-lab delete refusal, atomic plugin
  install ready and missing-dependency paths, same-plan post-parent, taxonomy,
  comment, and usermeta graph closures, and stale graph references.

The `wpOptionsScalar` surface seeds regular, non-plugin-owned `wp_options` rows
with scalar string and number values. Ready cases update the scalar option while
preserving the live remote; conflict cases drift the same option remotely and
must refuse apply without plugin-owner evidence.

The `wpOptionsScalarChanges` target coverage records per-tier counts for the
regular scalar `wp_options.option_value` update surface. Ready cases apply the
local scalar while preserving unplanned remote resources and rejecting stale
replay before mutation; conflict cases drift the same scalar remotely and refuse
apply so local scalar options cannot overwrite newer remote values.

The `wpOptionsSerialized` surface seeds regular, non-plugin-owned `wp_options`
rows with PHP-serialized option strings that include public labels plus private
fields such as `private_notes` and `auth_token`. Ready cases update the
serialized option while preserving the live remote; conflict cases drift the same
option remotely and must refuse apply without plugin-owner evidence.

The `wpOptionsSerializedChanges` target coverage records per-tier counts for
the serialized `wp_options.option_value` update surface. Ready cases apply the
local serialized payload while preserving unplanned remote resources and
rejecting stale replay before mutation; non-ready cases drift the same serialized
option remotely, fail closed, and keep private serialized payload evidence
redacted to hashes and metadata.

The `fileCreateUpdateDeleteMix` target coverage records per-tier counts for the
file create/update/delete surface. Ready cases create one file, update one file,
and delete one file, then reject stale replay before mutation; conflict cases
drift the updated file remotely and refuse apply.

The `directoryDescendantConflict` target coverage records per-tier counts for
local directory deletes where the remote either still only has the directory or
has added a descendant beneath it. Ready cases delete the unchanged remote
directory, preserve unplanned remote data, and reject stale replay before
mutation; conflicting cases refuse apply so a local directory delete cannot
hide or overwrite a live remote descendant.

The `wpPostsCreateUpdateDelete` target coverage records per-tier counts for the
`wp_posts` create/update/delete surface. Its invariant is that ready cases apply
only the planned post create, update, and delete while preserving every
unplanned remote resource, and every ready case rejects stale replay before any
mutation. Concurrent remote edits to the updated post remain `conflict` and
refuse apply so local `wp_posts` create/update/delete plans cannot overwrite
newer remote rows.

The `fileTypeSwap` target coverage records per-tier counts for file topology
type swaps. Ready cases replace an empty directory with the planned file value
and preserve unplanned remote resources; conflict cases add a remote descendant
under the directory and refuse apply.

The `sameIndependentContent` target coverage records per-tier counts for local
and remote edits that independently converge on the same content. Its ready
cases produce no mutation for the already-synchronized row, still apply through
the harness, and preserve every unplanned remote resource.

The `wpPostmetaCreateUpdateDelete` target coverage records per-tier counts for
the `wp_postmeta` create/update/delete surface. Its invariant is that ready
cases apply only the planned postmeta create, update, and delete while
preserving every unplanned remote resource; every ready case rejects stale
replay before mutation, and concurrent remote edits to the updated postmeta row
remain `conflict` and refuse apply so local postmeta plans cannot overwrite
newer remote rows.

The `wpCommentsCommentmetaGraph` target coverage records per-tier counts for
generated `wp_comments` rows and their `wp_commentmeta` graph relationships.
Ready cases create the comment and commentmeta row in one plan, preserve
unplanned remote resources, and reject stale replays before mutation; stale
cases keep the comment in the base, drift that comment remotely, and require the
new commentmeta reference to fail closed instead of overwriting the drifted
remote. RPP-0130 proves the ready and stale target cases across every tier and
keeps generated comment/commentmeta row values out of the summary evidence.

The `wpTermsTermmetaGraph` target coverage records per-tier counts for generated
`wp_terms` rows and their `wp_termmeta` graph relationships. Ready cases create
the term and termmeta row in one plan, preserve unplanned remote resources, and
reject stale replays before mutation; stale cases keep the term in the base,
drift that term remotely, and require the new termmeta reference to fail closed
instead of overwriting the drifted remote. RPP-0131 keeps the current 510-case
run and proves one ready terms/termmeta graph case in every tier plus stale
non-ready graph references in tiers 0 through 8.

The `wpUsersUsermetaGraph` target coverage records per-tier counts for
generated `wp_users` rows and their `wp_usermeta` graph relationships. Ready
cases create the user and usermeta row in one plan, preserve unplanned remote
resources, and reject stale replays before mutation; stale cases keep the user
in the base, drift that user remotely, and require the new usermeta reference to
fail closed instead of overwriting the drifted remote. RPP-0129 also keeps
private user password, activation-token, and usermeta payload values out of
summary and planner evidence by checking only redacted hashes and metadata.

The `rowCreateUpdateDeleteMix` target coverage records per-tier counts for the
generic row create/update/delete surface. Ready cases create, update, and delete
rows, preserve unplanned remote resources, and reject stale replay before
mutation; conflict cases drift the updated row remotely and refuse apply.

The `wpTermTaxonomyGraph` target coverage records per-tier counts for generated
`wp_term_taxonomy` rows and their `wp_terms` graph relationships. Ready cases
create the term and taxonomy row in one plan, preserve unplanned remote
resources, and reject a stale replay before mutation; stale cases keep the term
in the base, drift that term remotely, and require the new taxonomy reference to
fail closed instead of overwriting the drifted remote. RPP-0132 keeps the
current 510-case run and proves the 18 current term-taxonomy graph cases across
all 10 tiers, including nine ready cases, nine stale non-ready cases, and
hash-only redacted evidence for generated taxonomy descriptions and stale term
drift values.

The `wpTermRelationshipsGraph` target coverage records per-tier counts for
generated `wp_term_relationships` rows and their `wp_term_taxonomy` targets.
Ready cases create the term, taxonomy, and relationship in one plan, preserve
unplanned remote resources, and reject stale replay before mutation; stale
cases keep the term and taxonomy in the base, drift the taxonomy remotely, and
require the new relationship row to fail closed instead of applying partial
graph mutations. RPP-0133 keeps the current 510-case run and proves one
relationship target in every tier: five ready cases, five stale blocked cases,
and hash-only redacted evidence for generated relationship target values.

The `pluginOwnedOptionChange` target coverage records per-tier counts for
generated plugin-owned `wp_options` rows using the supported forms driver.
Ready cases apply the local option update with owner/driver evidence and reject
stale replays before mutation; conflict cases drift the same plugin-owned option
remotely and must refuse apply without losing the remote value.


The `largeReadyPlanTier` target coverage records one large ready plan per tier.
Each case combines post-row creates, updates, deletes, file creates, updates,
deletes, same-plan taxonomy/comment graph rows, and remote-only row/file drift.
The invariant is that all 10 cases stay `ready`, apply only planned resources,
preserve the remote-only drift, and reject stale replay before mutation.

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
  "minCasesRequired": 300,
  "statuses": {
    "blocked": 38,
    "conflict": 187,
    "ready": 285
  },
  "statusByTier": {
    "blocked": {
      "0": 8,
      "1": 9,
      "2": 5,
      "3": 4,
      "4": 6,
      "5": 1,
      "6": 1,
      "7": 1,
      "8": 1,
      "9": 2
    },
    "conflict": {
      "0": 14,
      "1": 14,
      "2": 18,
      "3": 18,
      "4": 17,
      "5": 21,
      "6": 22,
      "7": 21,
      "8": 22,
      "9": 20
    },
    "ready": {
      "0": 29,
      "1": 28,
      "2": 28,
      "3": 29,
      "4": 28,
      "5": 29,
      "6": 28,
      "7": 29,
      "8": 28,
      "9": 29
    }
  },
  "tiers": {
    "0": 51,
    "1": 51,
    "2": 51,
    "3": 51,
    "4": 51,
    "5": 51,
    "6": 51,
    "7": 51,
    "8": 51,
    "9": 51
  },
  "featureFamilies": {
    "already-in-sync": 63,
    "atomic-blocked": 10,
    "atomic-plugin-missing-dependency": 10,
    "atomic-plugin-stack-ready": 10,
    "atomic-ready": 10,
    "bulk-local-update": 363,
    "bulk-remote-preserve": 354,
    "comment-graph": 286,
    "comment-user": 18,
    "comment-user-graph": 18,
    "comment-user-graph-ready": 9,
    "comment-user-graph-stale": 9,
    "comment-user-ready": 9,
    "comment-user-stale-target": 9,
    "commentmeta-comment-graph": 20,
    "delete": 44,
    "delete-edit": 10,
    "delete-edit-conflict": 10,
    "direct-row-conflict": 10,
    "directory-delete-no-remote-descendant": 10,
    "directory-delete-with-remote-descendant": 10,
    "directory-descendant": 20,
    "directory-descendant-conflict": 10,
    "directory-descendant-ready": 10,
    "expected-blocked": 46,
    "expected-conflict": 170,
    "file-create": 30,
    "file-create-update-delete-mix": 20,
    "file-create-update-delete-mix-conflict": 10,
    "file-create-update-delete-mix-ready": 10,
    "file-delete": 30,
    "file-topology": 124,
    "file-topology-conflict": 10,
    "file-type-swap": 20,
    "file-type-swap-conflict": 10,
    "file-type-swap-ready": 10,
    "file-update": 30,
    "forms-lab-delete-blocked": 20,
    "forms-lab-supported": 30,
    "independent-local-and-remote": 10,
    "independent-merge": 10,
    "large-ready-plan": 10,
    "large-ready-plan-target": 10,
    "large-ready-plan-tier": 10,
    "local-create": 73,
    "local-delete": 10,
    "local-file-update": 10,
    "plugin-context-drift": 20,
    "plugin-context-metadata-drift": 10,
    "plugin-context-ready": 10,
    "plugin-file-update": 10,
    "plugin-owned-option-change": 18,
    "plugin-owned-option-change-conflict": 9,
    "plugin-owned-option-change-ready": 9,
    "plugin-owned-option-update": 18,
    "plugin-owned-supported": 370,
    "plugin-owned-unsupported": 81,
    "plugin-owner-context-drift": 10,
    "post-parent-graph": 10,
    "ready-candidate": 151,
    "remote-delete": 10,
    "remote-delete-local-unchanged": 10,
    "remote-only-post-update": 10,
    "remote-preserve": 40,
    "row-create": 30,
    "row-create-update-delete-mix": 20,
    "row-create-update-delete-mix-conflict": 10,
    "row-create-update-delete-mix-ready": 10,
    "row-delete": 30,
    "row-update": 30,
    "same-independent-content": 10,
    "same-independent-content-target": 10,
    "same-plan-comment-graph": 10,
    "same-plan-graph": 442,
    "same-plan-post-parent-graph": 10,
    "same-plan-taxonomy-graph": 10,
    "same-plan-user-meta-graph": 9,
    "scalar-option-number": 10,
    "scalar-option-string": 10,
    "scalar-option-update": 20,
    "serialized-option": 20,
    "serialized-option-array": 10,
    "serialized-option-object": 10,
    "serialized-option-update": 20,
    "stale-graph": 133,
    "stale-graph-reference": 10,
    "supported-forms-lab-table": 10,
    "supported-plugin-option": 10,
    "taxonomy-graph": 284,
    "term-relationship-object-graph": 10,
    "term-relationship-taxonomy-graph": 10,
    "term-taxonomy-term-graph": 18,
    "termmeta-term-graph": 19,
    "tier-0": 51,
    "tier-1": 51,
    "tier-2": 51,
    "tier-3": 51,
    "tier-4": 51,
    "tier-5": 51,
    "tier-6": 51,
    "tier-7": 51,
    "tier-8": 51,
    "tier-9": 51,
    "type-change": 20,
    "type-swap-conflict": 10,
    "type-swap-ready": 10,
    "unsupported-plugin-owned-row": 10,
    "user-meta-graph": 27,
    "usermeta-user-graph": 18,
    "wp-commentmeta-create": 20,
    "wp-comments-commentmeta-graph": 20,
    "wp-comments-commentmeta-graph-ready": 10,
    "wp-comments-commentmeta-graph-stale": 10,
    "wp-comments-create": 38,
    "wp-comments-remote-drift": 10,
    "wp-options-scalar": 20,
    "wp-options-scalar-conflict": 10,
    "wp-options-scalar-ready": 10,
    "wp-options-serialized": 20,
    "wp-options-serialized-change": 20,
    "wp-options-serialized-conflict": 10,
    "wp-options-serialized-ready": 10,
    "wp-options-update": 20,
    "wp-postmeta-create": 20,
    "wp-postmeta-create-update-delete": 20,
    "wp-postmeta-create-update-delete-conflict": 10,
    "wp-postmeta-create-update-delete-ready": 10,
    "wp-postmeta-delete": 20,
    "wp-postmeta-update": 20,
    "wp-posts-create": 20,
    "wp-posts-create-update-delete": 20,
    "wp-posts-create-update-delete-conflict": 10,
    "wp-posts-create-update-delete-ready": 10,
    "wp-posts-delete": 20,
    "wp-posts-update": 20,
    "wp-term-relationships-create": 10,
    "wp-term-relationships-graph": 10,
    "wp-term-relationships-graph-ready": 5,
    "wp-term-relationships-graph-stale": 5,
    "wp-term-relationships-graph-target": 10,
    "wp-term-relationships-remote-drift": 5,
    "wp-term-taxonomy-create": 18,
    "wp-term-taxonomy-graph": 18,
    "wp-term-taxonomy-graph-ready": 9,
    "wp-term-taxonomy-graph-stale": 9,
    "wp-termmeta-create": 19,
    "wp-terms-create": 37,
    "wp-terms-remote-drift": 18,
    "wp-terms-termmeta-graph": 19,
    "wp-terms-termmeta-graph-ready": 10,
    "wp-terms-termmeta-graph-stale": 9,
    "wp-usermeta-create": 18,
    "wp-users-create": 36,
    "wp-users-remote-drift": 18,
    "wp-users-usermeta-graph": 18,
    "wp-users-usermeta-graph-ready": 9,
    "wp-users-usermeta-graph-stale": 9
  },
  "targetCoverage": {
    "commentUserGraph": {
      "family": "comment-user-graph-ready",
      "total": 18,
      "perTier": {
        "0": 1,
        "1": 1,
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
        "blocked": 9,
        "ready": 9
      }
    },
    "directoryDescendantConflict": {
      "family": "directory-descendant-conflict",
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
    "fileCreateUpdateDeleteMix": {
      "family": "file-create-update-delete-mix-ready",
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
    "fileTypeSwap": {
      "family": "file-type-swap-ready",
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
    "largeReadyPlanTier": {
      "family": "large-ready-plan-tier",
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
        "ready": 10
      }
    },
    "pluginOwnedOptionChange": {
      "family": "plugin-owned-option-change-ready",
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
    "rowCreateUpdateDeleteMix": {
      "family": "row-create-update-delete-mix-ready",
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
    "sameIndependentContent": {
      "family": "same-independent-content",
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
        "ready": 10
      }
    },
    "staleRemoteAfterDryRun": {
      "family": "ready-plan-stale-remote-after-dry-run",
      "total": 284,
      "perTier": {
        "0": 28,
        "1": 28,
        "2": 28,
        "3": 29,
        "4": 28,
        "5": 29,
        "6": 28,
        "7": 29,
        "8": 28,
        "9": 29
      },
      "statuses": {
        "ready": 284
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
        "conflict": 7,
        "ready": 10
      }
    },
    "wpOptionsScalarChanges": {
      "family": "wp-options-scalar-ready",
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
    "wpOptionsSerializedChanges": {
      "family": "wp-options-serialized-ready",
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
    "wpTermRelationshipsGraph": {
      "family": "wp-term-relationships-graph",
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
        "blocked": 5,
        "ready": 5
      }
    },
    "wpTermsTermmetaGraph": {
      "family": "wp-terms-termmeta-graph-ready",
      "total": 19,
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
        "9": 1
      },
      "statuses": {
        "blocked": 4,
        "conflict": 5,
        "ready": 10
      }
    },
    "wpTermTaxonomyGraph": {
      "family": "wp-term-taxonomy-graph-ready",
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
        "blocked": 1,
        "conflict": 8,
        "ready": 9
      }
    },
    "wpUsersUsermetaGraph": {
      "family": "wp-users-usermeta-graph-ready",
      "total": 18,
      "perTier": {
        "0": 2,
        "1": 2,
        "2": 2,
        "3": 2,
        "4": 2,
        "5": 2,
        "6": 2,
        "7": 1,
        "8": 1,
        "9": 2
      },
      "statuses": {
        "blocked": 3,
        "conflict": 6,
        "ready": 9
      }
    }
  },
  "maxResourceCount": 74,
  "maxMutationCount": 46,
  "maxReadyResourceCount": 74,
  "maxReadyMutationCount": 46,
  "maxComplexityScore": 94,
  "totalMutations": 7229,
  "totalConflicts": 509,
  "totalBlockers": 518,
  "totalDecisions": 1399
}
```

## Extension Rule

Add new scenario families or seeded operations when a new Reprint push behavior
is needed. Do not add one-off expected snapshots for a single case unless the
case exposes a reusable generator capability. If a case needs an exact fixture,
it belongs in a narrow regression test beside the generated harness, not inside
the harness itself.
