# WordPress Graph Contracts

WordPress graph pushes are safe only when Reprint can prove what an identifier
means and where every reference points after a push. The graph contract turns
that proof surface into an explicit, versioned table instead of scattered
planner assumptions.

## Contract Version 1

The version-1 graph contract lives in `src/wordpress-graph-contracts.js`.

It declares relationship contracts:

- supported relationship types
- source table suffixes and source fields
- target table suffixes
- whether scalar reference rewriting is allowed
- required target validation
- conservative resolution policy for unsafe cases
- unsupported surfaces that must fail closed

Example relationship contract:

```json
{
  "schemaVersion": 1,
  "contractKind": "wordpress-graph-relationship",
  "relationshipType": "featured-image-attachment",
  "sourceSuffix": "postmeta",
  "sourceFields": ["meta_value"],
  "sourceCondition": "meta_key:_thumbnail_id",
  "targetSuffix": "posts",
  "scalarRewriteSupported": true,
  "targetValidation": "post-type:attachment",
  "samePlanSupported": true,
  "resolutionPolicy": "preserve-remote-wordpress-graph-and-stop",
  "rawValuesIncluded": false
}
```

It also declares the explicit identity-map contract:

```json
{
  "schemaVersion": 1,
  "contractKind": "wordpress-graph-identity-map",
  "operation": "wordpress-graph-identity-map-contract-validation",
  "sourceResourceKey": "row:[\"wp_posts\",\"ID:2001\"]",
  "targetResourceKey": "row:[\"wp_posts\",\"ID:3001\"]",
  "outcome": "accepted",
  "rawValuesIncluded": false
}
```

## Runtime Policy

The planner can apply graph-bearing changes only when references are proven by
one of these paths:

- the referenced target is unchanged on the live remote
- the referenced target is created or updated safely in the same plan
- an explicit graph identity map proves the local source row maps to an
  equivalent remote target row
- the relationship contract allows scalar rewriting and the identity map is
  usable

When planner rewrites a scalar graph reference, the mutation records the
relationship contract kind, version, and hash. Apply recomputes that contract
hash and rejects forged, missing, or unsupported rewrite evidence before any
mutation.

Legacy identity maps still normalize for existing local coverage, but an entry
that declares `contractKind: "wordpress-graph-identity-map"` is strict:
unsupported contract versions or kinds, missing row resources, or self-maps
fail closed before rewrite.

Otherwise the mutation is blocked before apply with
`stale-wordpress-graph-identity` and
`preserve-remote-wordpress-graph-and-stop`.

## Detect-Only Relationships

Serialized block references are detected but not scalar-rewritten in version 1:

- `serialized-block-attachment`
- `serialized-block-post`
- `serialized-block-reusable-block`

These contracts make unsafe references visible without pretending the system can
rewrite arbitrary block payloads safely.

## Fail-Closed Surfaces

The contract explicitly preserves/refuses these surfaces until a stronger
identity proof exists:

- unsupported post graph surfaces such as `nav_menu_item`, `revision`, and
  `wp_navigation`
- nav menu item metadata references
- `nav_menu` taxonomy graph rows
- custom taxonomy graph rows outside the supported core taxonomy set
- post natural identity collisions on `guid` or `post_type + post_name`

## Evidence

`scripts/bench/graph-mapping-inventory.js` emits the contract table as
`graphContract` evidence. The inventory records relationship contracts,
unsupported surface contracts, identity-map contract kind/version, identity-map
suffixes, collision surfaces, and family coverage without raw site values.

WordPress Playground snapshots exported by `scripts/playground/snapshot-lib.php`
also carry the exporter-side contract under `meta.wordpressGraphContracts`.
That metadata includes:

- the same relationship contract table used by the JS planner/apply path
- unsupported surface contracts and their fail-closed reason codes
- the explicit identity-map contract kind/version and supported table suffixes
- identity collision surfaces that must remain fail-closed
- `rawValuesIncluded: false`

The snapshot metadata is not a permission to widen support. It is a protocol
declaration: production exporters must state the graph contract they are
exporting against, and consumers must still reject unsupported or forged graph
rewrite evidence before mutation.

Snapshots may also carry explicit identity-map rows under
`meta.wordpressGraphIdentityMap.rows`. The PHP exporter only emits those rows
when a provider supplies them through the
`reprint_push_wordpress_graph_identity_map_rows` filter or the
`reprint_push_wordpress_graph_identity_map` option. Each exported row is
normalized to:

```json
{
  "contractVersion": 1,
  "contractKind": "wordpress-graph-identity-map",
  "sourceResourceKey": "row:[\"wp_posts\",\"ID:2001\"]",
  "targetResourceKey": "row:[\"wp_posts\",\"ID:3001\"]",
  "rawValuesIncluded": false
}
```

The exporter does not infer maps from slugs, GUIDs, or row contents. If no
explicit map is supplied, no identity map is exported. Malformed contract rows,
raw-value rows, self-maps, unsupported versions/kinds, and cross-surface maps
fail closed before snapshot export. Planner/apply still perform the stronger
equivalence, staleness, relationship contract, and pre-mutation checks.

Future graph support should extend the contract first, add refusal tests for
unsupported shapes, and only then add positive rewrite or same-plan support.
