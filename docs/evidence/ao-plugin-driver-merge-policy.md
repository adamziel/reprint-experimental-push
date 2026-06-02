# AO Plugin Driver Merge Policy Evidence

Date: 2026-06-02

## What Changed

Plugin-owned row driver contracts can now declare an optional `mergePolicy`.
Version 1 intentionally supports only `refuse-on-conflict`, normalized to:

```json
{
  "schemaVersion": 1,
  "strategy": "refuse-on-conflict",
  "conflictResolution": "preserve-remote-and-stop",
  "rawValuesIncluded": false
}
```

The normalized policy is included in the plugin row-driver contract hash and
canonical contract evidence. Planner carries the policy into the mutation
envelope, and apply refuses forged ready plans when the mutation-side policy no
longer matches the accepted contract evidence.

Direct local/remote conflicts on a plugin-owned row whose accepted contract
declares `refuse-on-conflict` now record hash-only
`plugin-driver-merge-policy-validation` evidence. The plan remains a
`conflict`, preserving the existing no-apply semantics, and the evidence binds
the refusal to the normalized merge policy, accepted contract hash, canonical
contract-validation hash, and base/local/remote row hashes.

Unsupported merge strategies, malformed merge-policy shapes, or policies that
claim raw values fail closed before mutation. The refusal evidence reports
reason codes and normalized metadata only; it does not copy plugin row payloads
or raw unsupported strategy strings.

## Verification

Focused checks passed:

```bash
node --check src/plugin-driver-contracts.js
node --check src/plugin-driver-validators.js
node --check src/planner.js
node --check src/apply.js
php -l scripts/playground/snapshot-lib.php
node --test --test-name-pattern 'merge policy|custom row driver contract|plugin-owned row driver contract|contract-bound row driver validator' test/plugin-driver-contract.test.js
node --test --test-name-pattern 'plugin-owned row drivers export explicit row-driver contracts|registered plugin-owned row driver PHP validation requires contract-bound evidence' test/plugin-driver-registration-api.test.js
```

Coverage includes:

- stable normalization from string and object merge-policy forms,
- contract-hash changes when a merge policy is added,
- planner acceptance and apply of a policy-bound custom row-driver mutation,
- planner conflict evidence for `refuse-on-conflict` plugin-owned rows,
- planner refusal for unsupported merge strategies,
- apply refusal for forged ready plans whose mutation envelope changes the
  accepted merge policy,
- PHP registered-driver snapshot export with normalized merge-policy metadata.

## Caveat

This does not implement semantic plugin merging. It makes the first merge-driver
boundary explicit and conservative: a plugin contract may declare that conflicts
must preserve remote state and stop. Merge strategies beyond
`refuse-on-conflict`, plugin-owned file policies, side-effect recovery, and
plugin-provided reference extractors remain separate release-scope work.
