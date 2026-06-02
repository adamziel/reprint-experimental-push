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
  "supportsDelete": false
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
- accepted contracts emit `plugin-driver-contract-validation` evidence
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
- accepted `contract-bound-row-driver` payload validation evidence,
- hash-only value and contract evidence, with `rawValuesIncluded: false`.

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
