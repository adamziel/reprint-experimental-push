# WordPress Graph Contracts

WordPress graph pushes are safe only when Reprint can prove what an identifier
means and where every reference points after a push. The graph contract turns
that proof surface into an explicit, versioned table instead of scattered
planner assumptions.

## Contract Version 1

The version-1 graph contract lives in `src/wordpress-graph-contracts.js`.

It declares:

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

## Runtime Policy

The planner can apply graph-bearing changes only when references are proven by
one of these paths:

- the referenced target is unchanged on the live remote
- the referenced target is created or updated safely in the same plan
- an explicit graph identity map proves the local source row maps to an
  equivalent remote target row
- the relationship contract allows scalar rewriting and the identity map is
  usable

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
unsupported surface contracts, identity-map suffixes, collision surfaces, and
family coverage without raw site values.

Future graph support should extend the contract first, add refusal tests for
unsupported shapes, and only then add positive rewrite or same-plan support.
