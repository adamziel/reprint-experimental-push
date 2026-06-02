# Plugin Driver Contracts

Plugin-owned WordPress data is safe to push only when the owning plugin can
explain the data surface. Reprint therefore treats plugin support as an
explicit contract, not as a generic row/file merge.

## Contract Version 1

The first explicit contract shape is a plugin-owned row driver:

```json
{
  "contractVersion": 1,
  "contractKind": "plugin-owned-row-driver",
  "resourceKey": "row:[\"wp_options\",\"option_name:forms_settings\"]",
  "pluginOwner": "forms",
  "driver": "wp-option",
  "table": "wp_options",
  "supportsDelete": false,
  "contractHash": "..."
}
```

Required fields:

- `contractVersion`: must be `1`.
- `contractKind`: must be `plugin-owned-row-driver`.
- `resourceKey`: the exact modeled resource key.
- `pluginOwner`: the owning plugin slug or owner id.
- `driver`: the row driver name.

Optional fields:

- `table`: the expected WordPress table for row drivers.
- `supportsDelete`: boolean delete capability. Missing or `false` means delete
  mutations refuse before apply.
- `rowSchema`: optional contract metadata for schema-bound custom row drivers.
  Version 1 supports required row fields, nested object `properties`,
  `additionalProperties: false` for declared object properties, and field
  types: `string`, `integer`, `number`, `boolean`, `object`, `array`, and
  `null`. Scalar fields may also declare `const` or `enum` constraints; the
  normalized contract stores these as `constHash` or sorted `enumHashes`, never
  as raw values.
- `mergePolicy`: optional conflict-policy metadata for plugin-owned row
  drivers. Version 1 supports only `refuse-on-conflict`, normalized to a
  hash-bound object with `conflictResolution: "preserve-remote-and-stop"` and
  `rawValuesIncluded: false`.
- `referenceFields`: optional metadata for plugin-owned row fields that carry
  scalar references to WordPress rows. Version 1 supports only dot-separated
  field paths whose values are positive integers, with an explicit
  `targetTable`, `targetIdField`, optional `required`, and
  `rawValuesIncluded: false`. Targets are limited to known WordPress graph
  primary-row pairs: `wp_posts/ID`, `wp_users/ID`,
  `wp_comments/comment_ID`, `wp_terms/term_id`,
  `wp_term_taxonomy/term_taxonomy_id`, `wp_blogs/blog_id`, and
  `wp_site/id`. Site table prefixes may vary, but the resolved table suffix
  and primary ID field must match one of those pairs.
- `contractHash`: stable hash of the declared resource key, owner, driver,
  table, delete support, contract kind, contract version, optional normalized
  row schema, optional normalized merge policy, and optional normalized
  reference fields.
- `dryRunValidation`: hash-only dry-run validation hook evidence.
- `applyValidation`: hash-only apply validation hook evidence.
- `evidenceScope` or `releaseGateEvidenceScope`: evidence classification.
- `rawValuesIncluded`: may be present only as `false`; any other value refuses
  before mutation.

## Runtime Policy

Legacy fixture policies still normalize for existing lab coverage, but an entry
that declares an explicit contract becomes strict:

- unsupported `contractVersion` refuses before mutation
- missing or unsupported `contractKind` refuses before mutation
- missing `resourceKey`, `pluginOwner`, or `driver` refuses before mutation
- malformed `supportsDelete` refuses before mutation
- `rawValuesIncluded` values other than `false` refuse before mutation
- malformed `rowSchema` objects or unsupported schema field types refuse before
  mutation with `PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA` or
  `PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA_TYPE`
- malformed schema constraints, mixed raw/hash constraint forms, constraints on
  non-scalar fields, or empty enum sets refuse before mutation with
  `PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA`
- unsupported merge policies, malformed merge-policy shapes, or merge-policy
  declarations that claim raw values refuse before mutation with
  `PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_MERGE_POLICY`,
  `PLUGIN_DRIVER_CONTRACT_INVALID_MERGE_POLICY`, or
  `PLUGIN_DRIVER_CONTRACT_MERGE_POLICY_RAW_VALUES_INCLUDED`
- malformed reference-field declarations, unsupported reference scalar types,
  unsupported target tables or mismatched target primary ID fields, or
  reference-field declarations that claim raw values refuse before mutation
  with `PLUGIN_DRIVER_CONTRACT_INVALID_REFERENCE_FIELDS`,
  `PLUGIN_DRIVER_CONTRACT_INVALID_REFERENCE_FIELD`,
  `PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_REFERENCE_FIELD_TYPE`,
  `PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_REFERENCE_TARGET`, or
  `PLUGIN_DRIVER_CONTRACT_REFERENCE_FIELDS_RAW_VALUES_INCLUDED`
- accepted contracts emit `plugin-driver-contract-validation` evidence
- accepted contracts must carry the expected `contractHash`, and apply
  recomputes it before trusting the evidence
- accepted contract evidence must match the canonical hash-only evidence
  envelope. Extra fields, raw-value sidecars, stale evidence hashes, or
  non-canonical rewrites refuse before mutation with
  `PLUGIN_DRIVER_CONTRACT_VALIDATION_EVIDENCE_MISMATCH`.
- contract evidence is hash-only and carries no raw plugin payload values
- accepted contract evidence does not by itself authorize a mutation: the
  mutation envelope must still carry the same `pluginOwner`, `driver`, resource,
  table, `supportsDelete`, and merge-policy binding at apply time

This lets production integrations ratchet from allowlist-shaped support toward
stable, reviewable plugin contracts without breaking older lab fixtures.

## WordPress Snapshot Export

The Playground/WordPress snapshot helper emits this contract shape for
plugin-owned row resources exported through `meta.pluginOwnedResources`.

Registered PHP row drivers are exported with:

- `contractVersion: 1`
- `contractKind: "plugin-owned-row-driver"`
- exact `resourceKey`
- `pluginOwner`
- `driver`
- `table`
- boolean `supportsDelete`
- optional normalized `mergePolicy`
- optional normalized `referenceFields`

The built-in `reprint-push-release-state` row driver and registered custom row
drivers use the same policy-entry shape. Contract entries are metadata only and
do not include row payload values.

## Contract-Bound Validation

Planner and apply treat explicit row-driver contracts as more than allowlist
shape. For custom row drivers outside the built-in driver set, apply requires:

- accepted `plugin-driver-contract-validation` evidence,
- exact resource key, plugin owner, driver, table, and `supportsDelete` binding
  in both the contract evidence and the mutation envelope,
- present row payloads that carry `__pluginOwner` equal to the contract owner;
  missing markers refuse with
  `PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_OWNER_MISSING`, and wrong markers refuse
  with `PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_OWNER_MISMATCH`,
- present row payloads whose identity fields match the row resource id. For a
  resource such as `row:["wp_forms_contract_rows","entry_id:7"]`, the payload
  must carry `entry_id` equal to `7`; mismatches refuse with
  `PLUGIN_DRIVER_CONTRACT_BOUND_ROW_ID_MISMATCH`, and unparseable row identity
  shapes refuse with `PLUGIN_DRIVER_CONTRACT_BOUND_ROW_ID_UNSUPPORTED`,
- present row payloads that satisfy the optional schema-bound row contract.
  Missing required fields refuse with
  `PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_FIELD_MISSING`; wrong field types
  refuse with `PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_TYPE_MISMATCH`; extra
  object properties under `additionalProperties: false` refuse with
  `PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_UNEXPECTED_FIELD`; scalar `const` or
  `enum` mismatches refuse with
  `PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_CONSTRAINT_MISMATCH`,
- present row payloads that satisfy the optional reference-field contract.
  Missing required reference paths refuse with
  `PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_FIELD_MISSING`; non-positive or
  non-integer reference values refuse with
  `PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_FIELD_INVALID`,
- accepted `contract-bound-row-driver` payload validation evidence,
- hash-only value and contract evidence, with `rawValuesIncluded: false`,
- carried payload evidence that matches apply's recomputed mutation action,
  value state/hash, row identity evidence, schema validation evidence when a
  schema is declared, reference validation evidence when reference fields are
  declared, contract hash, and canonical `contractValidationHash`.

If a contract declares `mergePolicy`, planner carries the normalized policy
into the mutation envelope and apply recomputes the accepted contract hash and
requires the mutation-side policy to match it exactly. A forged ready plan that
changes or drops the merge policy refuses before mutation with
`PLUGIN_DRIVER_CONTRACT_BOUND_MERGE_POLICY_MISMATCH`.

For direct local/remote conflicts on a plugin-owned row whose accepted contract
declares `mergePolicy: "refuse-on-conflict"`, planner keeps the plan in
`conflict` status and records hash-only
`plugin-driver-merge-policy-validation` evidence. That evidence binds the
refusal to the accepted contract hash, canonical contract-validation hash,
normalized merge policy, and base/local/remote row hashes.

Payload validation evidence now includes a hash-only `rowIdentity` object:

```json
{
  "resourceId": "entry_id:7",
  "status": "matched",
  "fields": [
    {
      "field": "entry_id",
      "expected": "7",
      "observedHash": "...",
      "matched": true
    }
  ]
}
```

The verifier and apply path recompute this object from the mutation resource and
planned payload. A forged ready plan that changes the payload's row id while
keeping the resource key stable is rejected before mutation, even if the forged
payload hash has been made internally consistent.

Schema-bound contracts also emit a hash-only `schemaValidation` object when
`rowSchema` is present:

```json
{
  "schemaHash": "...",
  "status": "matched",
  "fields": [
    {
      "field": "payload",
      "expectedType": "object",
      "required": true,
      "state": "present",
      "observedType": "object",
      "matched": true
    },
    {
      "field": "mode",
      "path": "payload.mode",
      "expectedType": "string",
      "required": true,
      "state": "present",
      "observedType": "string",
      "constraint": "enum",
      "constraintHash": "...",
      "observedHash": "...",
      "matched": true
    }
  ]
}
```

The validation evidence reports field names, expected types, observed type
classes, optional declared schema paths, hash-only constraint identities, and
match booleans. It does not copy raw plugin row values. For undeclared object
properties it reports the declared object path and an
`observedExtraPropertyCount`, not the raw extra key names. For scalar `const`
and `enum` rules it reports only `constraint`, `constraintHash`, and
`observedHash`.
The production-shaped RPP-0483 verifier now includes
`payloadSchemaValidationMatchesExpected`, exact payload evidence shape checks,
and allowlist row-schema/contract-hash binding; it refuses proofs whose value
hashes match but whose row body no longer satisfies the declared schema.

Reference-field contracts emit a hash-only `referenceValidation` object when
`referenceFields` is present. The `targetResourceKey` is derived only after
the declared `targetTable` and `targetIdField` pass the WordPress graph
primary-row target constraint:

```json
{
  "referenceFieldsHash": "...",
  "status": "matched",
  "fields": [
    {
      "path": "payload.post_id",
      "targetTable": "wp_posts",
      "targetIdField": "ID",
      "scalarType": "positive-integer",
      "required": true,
      "state": "present",
      "observedType": "integer",
      "observedHash": "...",
      "targetResourceKey": "row:[\"wp_posts\",\"ID:2\"]",
      "matched": true
    }
  ]
}
```

This is a validator boundary, not a generic plugin graph rewriter. It proves
declared reference fields are shaped and hash-bound before mutation; production
graph rewrites for arbitrary plugin payloads still need explicit extractor and
rewriter contracts. Plugin-owned reference fields cannot point at arbitrary
plugin or custom tables merely because a target row exists and is hash-stable.

Legacy fixture allowlists still work for focused tests, but generic production
custom row drivers need the explicit contract path before the executor will
apply them.

## Production Direction

The row-driver contract is the first step toward a broader plugin API. Future
contracts should cover:

- merge-driver conflict policies for plugin-owned payloads
- merge-driver conflict policies beyond conservative `refuse-on-conflict`
- richer JSON Schema semantics beyond scalar `const`/`enum`
- plugin-owned files
- plugin activation and update side effects
- plugin-provided graph identities
- plugin-provided reference extractors and rewriters
- recovery classification after partial plugin-owned mutation
- rollback or refusal rules for unsupported side effects

Unknown plugin-owned data remains conservative by default: preserve remote
changes, block local mutation, and return evidence that explains the missing
driver contract.
