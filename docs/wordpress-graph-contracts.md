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
  "contractHash": "sha256 hash of the normalized identity-map contract",
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

Relationship contracts also define target validation. Version 1 validates core
primary row targets for posts, comments, terms, term taxonomy rows, blogs,
sites, and users by checking that the referenced row body carries the same
primary ID as the target resource key. Malformed same-plan targets stop as
`stale-wordpress-graph-identity` even when the source row and target hash
evidence are otherwise internally consistent.

Plugin row-driver `referenceFields` use the same primary-row target boundary
for target declarations. A plugin contract may declare scalar references only
to supported WordPress graph primary IDs such as `wp_posts/ID`,
`wp_comments/comment_ID`, `wp_users/ID`, `wp_terms/term_id`,
`wp_term_taxonomy/term_taxonomy_id`, `wp_blogs/blog_id`, and `wp_site/id`.
Arbitrary plugin or custom table targets remain unsupported until a separate
extractor/rewriter contract can prove their graph semantics.

When planner rewrites a scalar graph reference, the mutation records the
relationship contract kind, version, and hash. For rewrites backed by an
explicit identity map, it also records the normalized identity-map
`contractHash`. Apply recomputes both contract hashes and rejects forged,
missing, or unsupported rewrite evidence before any mutation.

For meta tables whose row resource IDs include the referenced owner ID, planner
also rewrites the dependent row key. Version 1 covers composite meta IDs shaped
like `<owner_field>:<id>:meta_key:<key>` for supported WordPress meta families,
including `wp_blogmeta.blog_id` and `wp_sitemeta.site_id`. Apply then validates
that the serialized payload field and the rewritten row key point at the same
carried target row.

Rows whose identity does not contain the rewritten field keep their row key.
For multisite `wp_blogs.site_id`, the `blog_id:<id>` row resource stays fixed
while the serialized `site_id` payload rewrites to the proven remote `wp_site`
target. Apply validates the payload against the carried target site before any
mutation.

Identity-map equivalence is proven only against maps already promoted as usable.
The candidate map may rewrite its own primary row ID during equivalence
comparison, but nested scalar references inside that row must resolve through a
separately proven map. The planner promotes maps with a fixed-point pass, so
valid nested maps are not sensitive to exporter row order; an invalid nested map
cannot make another map usable.

Apply also checks that each rewritten scalar field in the serialized mutation
payload equals the primary ID from the carried `targetResourceKey`. Primary IDs
are derived by WordPress table suffix, so prefixed site tables and multisite
global targets such as `wp_blogs.blog_id` and `wp_site.id` stay bound to the
same evidence path. A mutation whose rewrite evidence points at one row while
the payload writes a different ID is refused before mutation with
`WORDPRESS_GRAPH_REWRITE_TARGET_VALUE_MISMATCH`, with hash-only expected and
observed ID evidence.

Legacy identity maps still normalize for existing local coverage, but an entry
that declares `contractKind: "wordpress-graph-identity-map"` is strict:
unsupported contract versions, missing or unsupported contract kinds,
`rawValuesIncluded` values other than `false`, missing row resources,
self-maps, unsupported table surfaces, or cross-surface source/target pairs
fail closed before rewrite.

Accepted explicit identity-map contracts are also mandatory rewrite evidence.
When a ready plan carries a `map-local-identity-to-remote` decision with
accepted contract validation evidence, each dependent graph rewrite must carry
the matching `identityMapContractHash` and
`identityMapContractValidationHash`, and its `targetResourceKey` must match the
decision target. Apply rejects stripped or mismatched rewrite-side contract
evidence before mutation.

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
  "contractHash": "sha256 hash of the normalized identity-map contract",
  "rawValuesIncluded": false
}
```

The exporter does not infer maps from slugs, GUIDs, or row contents. If no
explicit map is supplied, no identity map is exported. Malformed contract rows,
raw-value rows, self-maps, unsupported versions/kinds, unsupported table
surfaces, and cross-surface maps fail closed before snapshot export and JS
planning. If a row supplies `contractHash`, it must match the normalized
source/target identity-map contract; mismatches fail closed with
`WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_HASH_MISMATCH` in JS planning and with a
snapshot export refusal in PHP. Planner/apply still perform the stronger
equivalence, staleness, relationship contract, rewrite evidence, and
pre-mutation checks.

Future graph support should extend the contract first, add refusal tests for
unsupported shapes, and only then add positive rewrite or same-plan support.
