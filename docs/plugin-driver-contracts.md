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
  Version 1 supports required top-level row fields and field types:
  `string`, `integer`, `number`, `boolean`, `object`, `array`, and `null`.
- `contractHash`: stable hash of the declared resource key, owner, driver,
  table, delete support, contract kind, contract version, and optional
  normalized row schema.
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
  table, and `supportsDelete` binding at apply time

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
  refuse with `PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_TYPE_MISMATCH`,
- accepted `contract-bound-row-driver` payload validation evidence,
- hash-only value and contract evidence, with `rawValuesIncluded: false`,
- carried payload evidence that matches apply's recomputed mutation action,
  value state/hash, row identity evidence, schema validation evidence when a
  schema is declared, contract hash, and canonical `contractValidationHash`.

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
    }
  ]
}
```

The validation evidence reports field names, expected types, observed type
classes, and match booleans. It does not copy raw plugin row values. The
production-shaped RPP-0483 verifier now includes
`payloadSchemaValidationMatchesExpected` and refuses proofs whose value hashes
match but whose row body no longer satisfies the declared schema.

Legacy fixture allowlists still work for focused tests, but generic production
custom row drivers need the explicit contract path before the executor will
apply them.

## Production Direction

The row-driver contract is the first step toward a broader plugin API. Future
contracts should cover:

- plugin-owned files
- plugin activation and update side effects
- plugin-provided graph identities
- plugin-provided reference extractors and rewriters
- recovery classification after partial plugin-owned mutation
- rollback or refusal rules for unsupported side effects

Unknown plugin-owned data remains conservative by default: preserve remote
changes, block local mutation, and return evidence that explains the missing
driver contract.
