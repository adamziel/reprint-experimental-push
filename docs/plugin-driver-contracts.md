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

## Runtime Policy

Legacy fixture policies still normalize for existing lab coverage, but an entry
that declares an explicit contract becomes strict:

- unsupported `contractVersion` refuses before mutation
- unsupported `contractKind` refuses before mutation
- missing `resourceKey`, `pluginOwner`, or `driver` refuses before mutation
- malformed `supportsDelete` refuses before mutation
- accepted contracts emit `plugin-driver-contract-validation` evidence
- contract evidence is hash-only and carries no raw plugin payload values

This lets production integrations ratchet from allowlist-shaped support toward
stable, reviewable plugin contracts without breaking older lab fixtures.

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
